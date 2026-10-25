// Stepwise MVP live database (PLAN.md §5 "Event log"; SpacetimeDB replaces Convex).
// The edge app writes through reducers over HTTP; the supervisor dashboard
// subscribes with the TypeScript SDK. Photos live on the edge laptop; rows hold paths.
import { ScheduleAt, type Identity } from 'spacetimedb';
import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';

const worker = table(
  { name: 'worker', public: true },
  {
    id: t.string().primaryKey(),
    name: t.string(),
    createdAt: t.timestamp(),
  }
);

const task = table(
  { name: 'task', public: true },
  {
    id: t.string().primaryKey(),
    title: t.string(),
    stepsJson: t.string(), // PLAN.md step list: [{id, instruction, done_right, common_mistake, correction, why, reference_photo}]
    updatedAt: t.timestamp(),
  }
);

const session = table(
  { name: 'session', public: true },
  {
    id: t.string().primaryKey(),
    workerId: t.string().index('btree'),
    taskId: t.string(),
    stepIndex: t.u32(),
    status: t.string(), // active | done | stopped
    startedAt: t.timestamp(),
    endedAt: t.option(t.timestamp()),
  }
);

const stepEvent = table(
  { name: 'step_event', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.string().index('btree'),
    workerId: t.string().index('btree'),
    taskId: t.string(),
    stepId: t.u32(),
    kind: t.string(), // done | mistake | in_progress | unclear | skipped | instruction
    source: t.string(), // bitdeer | claude | voice | button | timeout | system
    trigger: t.string(), // pause | left_area | voice | timeout | button | none
    confidence: t.f32(),
    latencyMs: t.u32(),
    note: t.string(),
    photo: t.string(), // edge path, '' if none
    ts: t.timestamp(),
  }
);

const helpRequest = table(
  { name: 'help_request', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.string(),
    workerId: t.string().index('btree'),
    taskId: t.string(),
    stepId: t.u32(),
    photo: t.string(),
    status: t.string(), // open | claimed | resolved
    claimedBy: t.string(),
    note: t.string(),
    createdAt: t.timestamp(),
    resolvedAt: t.option(t.timestamp()),
  }
);

const talkEvent = table(
  { name: 'talk_event', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.string(),
    workerId: t.string(),
    said: t.string(),
    intent: t.string(), // check | next | repeat | why | help | open
    answer: t.string(),
    answeredBy: t.string(), // instant | bitdeer | claude
    latencyMs: t.u32(),
    ts: t.timestamp(),
  }
);

// Every tap on "I'm going" (supervisor screen or a buddy's phone). The claim reducer is one
// transaction, so exactly one attempt per help request can win; the rest are recorded as lost.
const claimAttempt = table(
  { name: 'claim_attempt', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    helpId: t.u64().index('btree'),
    by: t.string(),
    won: t.bool(),
    winner: t.string(), // who holds the claim after this attempt
    ts: t.timestamp(),
  }
);

// ───────────── Layer A · identity: one SpacetimeDB identity per device ─────────────
// The edge app (glasses laptop), supervisor screens, buddy phones and worker screens each hold
// their own identity. Reducers check the caller's role; presence comes from lifecycle hooks
// (WebSocket clients) and heartbeats + a scheduled sweep (the edge app talks HTTP).
const device = table(
  { name: 'device', public: true },
  {
    identity: t.identity().primaryKey(),
    role: t.string(), // edge | supervisor | buddy | worker_screen
    name: t.string(),
    workerId: t.string(), // worker_screen: whose screen; '' otherwise
    online: t.bool(),
    lastSeen: t.timestamp(),
  }
);

// ───────────── Layer B · fading support (AGENTS.md §10), authoritative here ─────────────
// One row per worker × task step. Level 0 full instruction · 1 short cue · 2 alerts only ·
// 3 independent. Promote after 3 clean completions in a row; step back after 2 errors in the
// last 5. The rules run inside one reducer transaction, so two devices can never disagree.
const mastery = table(
  { name: 'mastery', public: true },
  {
    key: t.string().primaryKey(), // workerId|taskId|stepId
    workerId: t.string().index('btree'),
    taskId: t.string(),
    stepId: t.u32(),
    level: t.u8(),
    streak: t.u32(), // clean completions in a row at this level
    recent: t.string(), // last 5 outcomes at this level, oldest first: c clean · e error · a assisted
    attempts: t.u32(),
    updatedAt: t.timestamp(),
  }
);

// Append-only history of every step completion and every level change (replay, reports, progress).
const stepOutcome = table(
  { name: 'step_outcome', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    sessionId: t.string().index('btree'),
    workerId: t.string().index('btree'),
    taskId: t.string(),
    stepId: t.u32(),
    outcome: t.string(), // clean | error | assisted | override
    levelBefore: t.u8(),
    levelAfter: t.u8(),
    reason: t.string(), // '' | promote | demote | coach
    by: t.string(),
    ts: t.timestamp(),
  }
);

// Event table: broadcast the moment a level changes (the worker's screen says the celebration,
// the floor flashes it). Clients get onInsert only; nothing is cached. History lives in step_outcome.
const levelChange = table(
  { name: 'level_change', public: true, event: true },
  {
    workerId: t.string(),
    taskId: t.string(),
    stepId: t.u32(),
    fromLevel: t.u8(),
    toLevel: t.u8(),
    reason: t.string(), // promote | demote | coach
    by: t.string(),
  }
);

// ───────────── Layer C · help routing: buddies first, supervisor after 20 s ─────────────
const helpRoute = table(
  { name: 'help_route', public: true },
  {
    helpId: t.u64().primaryKey(),
    routedTo: t.string(), // buddy | supervisor
    escalatedAt: t.option(t.timestamp()),
  }
);

const helpEscalationTimer = table(
  { name: 'help_escalation_timer' }, // private: only the module sees its own timers
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    helpId: t.u64(),
  }
);

// ───────────── Layer D · rollups the floor subscribes to ─────────────
const workerProgress = table(
  { name: 'worker_progress', public: true },
  {
    workerId: t.string().primaryKey(),
    stepsTracked: t.u32(),
    atFull: t.u32(),
    atCue: t.u32(),
    atAlerts: t.u32(),
    independent: t.u32(),
    promotions7d: t.u32(),
    cleanLast24h: t.u32(),
    updatedAt: t.timestamp(),
  }
);

const rollupTimer = table(
  { name: 'rollup_timer' },
  { scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt() }
);

const presenceTimer = table(
  { name: 'presence_timer' },
  { scheduledId: t.u64().primaryKey().autoInc(), scheduledAt: t.scheduleAt() }
);

// ───────────── Layer E · voice agent: conversations with the coach (Cartesia Managed Agent) ─────────────
// The worker screen holds the call's WebSocket to Cartesia; it is the only identity that may write to the
// call it started (owner check in every reducer). Transcripts are private tables: only supervisor
// devices read them, through per-identity views. Buddy phones and other screens see call metadata only.
const agentCall = table(
  { name: 'agent_call', public: true },
  {
    callId: t.string().primaryKey(), // Cartesia call id (session_ready)
    owner: t.identity().index('btree'), // the worker screen that holds the WebSocket
    workerId: t.string().index('btree'), // from the owner's device row, never from the caller's arguments
    sessionId: t.string(),
    taskId: t.string(),
    agentVersion: t.string(),
    voice: t.string(), // whose voice the agent speaks in
    status: t.string(), // live | ended | dropped
    endReason: t.string(), // worker | agent | coach | dropped | error
    turns: t.u32(),
    toolCalls: t.u32(),
    startedAt: t.timestamp(),
    endedAt: t.option(t.timestamp()),
  }
);

const agentTurn = table(
  { name: 'agent_turn' }, // private: read through the supervisor_transcript view
  {
    id: t.u64().primaryKey().autoInc(),
    callId: t.string().index('btree'),
    workerId: t.string().index('btree'),
    turn: t.u32(),
    role: t.string(), // user | assistant
    text: t.string(),
    interrupted: t.bool(), // the worker talked over the agent (barge-in)
    responseMs: t.u32(), // assistant: end of the worker's turn → agent starts talking (measured by Cartesia's clock)
    ts: t.timestamp(),
  }
);

const agentToolCall = table(
  { name: 'agent_tool_call' }, // private: read through the supervisor_tool_calls view
  {
    id: t.u64().primaryKey().autoInc(),
    callId: t.string().index('btree'),
    workerId: t.string().index('btree'),
    toolCallId: t.string(),
    tool: t.string(), // what_is_my_step | check_my_work | call_a_helper | my_progress | change_step | remember
    argsJson: t.string(),
    result: t.string(), // what the agent was told
    ok: t.bool(),
    latencyMs: t.u32(), // client_tool_call received → client_tool_result sent
    ts: t.timestamp(),
  }
);

// Rollup: measured voice-agent numbers per worker (the floor and the pitch quote only these).
const agentStats = table(
  { name: 'agent_stats', public: true },
  {
    workerId: t.string().primaryKey(),
    calls: t.u32(),
    live: t.u32(),
    turns: t.u32(),
    toolCalls: t.u32(),
    checks: t.u32(),
    helpAlerts: t.u32(),
    bargeIns: t.u32(),
    p50ResponseMs: t.u32(),
    p90ResponseMs: t.u32(),
    p50ToolMs: t.u32(),
    updatedAt: t.timestamp(),
  }
);

const spacetimedb = schema({
  worker, task, session, stepEvent, helpRequest, talkEvent, claimAttempt,
  device, mastery, stepOutcome, levelChange, helpRoute, helpEscalationTimer, workerProgress, rollupTimer, presenceTimer,
  agentCall, agentTurn, agentToolCall, agentStats,
});
export default spacetimedb;

export const upsertWorker = spacetimedb.reducer({ id: t.string(), name: t.string() }, (ctx, { id, name }) => {
  const w = ctx.db.worker.id.find(id);
  if (w) ctx.db.worker.id.update({ ...w, name });
  else ctx.db.worker.insert({ id, name, createdAt: ctx.timestamp });
});

export const saveTask = spacetimedb.reducer(
  { id: t.string(), title: t.string(), stepsJson: t.string() },
  (ctx, { id, title, stepsJson }) => {
    const row = { id, title, stepsJson, updatedAt: ctx.timestamp };
    if (ctx.db.task.id.find(id)) ctx.db.task.id.update(row);
    else ctx.db.task.insert(row);
  }
);

export const deleteTask = spacetimedb.reducer({ id: t.string() }, (ctx, { id }) => {
  ctx.db.task.id.delete(id);
});

export const startSession = spacetimedb.reducer(
  { id: t.string(), workerId: t.string(), taskId: t.string() },
  (ctx, { id, workerId, taskId }) => {
    if (ctx.db.session.id.find(id)) throw new SenderError('session exists');
    ctx.db.session.insert({ id, workerId, taskId, stepIndex: 0, status: 'active', startedAt: ctx.timestamp, endedAt: undefined });
  }
);

export const setStep = spacetimedb.reducer({ sessionId: t.string(), stepIndex: t.u32() }, (ctx, { sessionId, stepIndex }) => {
  const s = ctx.db.session.id.find(sessionId);
  if (!s) throw new SenderError('no such session');
  ctx.db.session.id.update({ ...s, stepIndex });
});

export const endSession = spacetimedb.reducer({ sessionId: t.string(), status: t.string() }, (ctx, { sessionId, status }) => {
  const s = ctx.db.session.id.find(sessionId);
  if (!s) throw new SenderError('no such session');
  ctx.db.session.id.update({ ...s, status, endedAt: ctx.timestamp });
});

export const logStepEvent = spacetimedb.reducer(
  {
    sessionId: t.string(),
    workerId: t.string(),
    taskId: t.string(),
    stepId: t.u32(),
    kind: t.string(),
    source: t.string(),
    trigger: t.string(),
    confidence: t.f32(),
    latencyMs: t.u32(),
    note: t.string(),
    photo: t.string(),
  },
  (ctx, args) => {
    ctx.db.stepEvent.insert({ id: 0n, ...args, ts: ctx.timestamp });
  }
);

export const requestHelp = spacetimedb.reducer(
  { sessionId: t.string(), workerId: t.string(), taskId: t.string(), stepId: t.u32(), photo: t.string() },
  (ctx, args) => {
    const h = ctx.db.helpRequest.insert({ id: 0n, ...args, status: 'open', claimedBy: '', note: '', createdAt: ctx.timestamp, resolvedAt: undefined });
    // buddies first; if nobody has claimed it in 20 s, the scheduled reducer routes it to the supervisor
    ctx.db.helpRoute.insert({ helpId: h.id, routedTo: 'buddy', escalatedAt: undefined });
    ctx.db.helpEscalationTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch + ESCALATE_AFTER_MICROS), helpId: h.id });
  }
);

// Atomic: the first claimer wins. A later claim is not an error: it is recorded as a lost attempt
// (an error would roll the record back), so the floor can show the race and count double-claims.
export const claimHelp = spacetimedb.reducer({ id: t.u64(), by: t.string() }, (ctx, { id, by }) => {
  const h = ctx.db.helpRequest.id.find(id);
  if (!h) throw new SenderError('no such help request');
  const won = h.status === 'open';
  if (won) ctx.db.helpRequest.id.update({ ...h, status: 'claimed', claimedBy: by });
  ctx.db.claimAttempt.insert({ id: 0n, helpId: id, by, won, winner: won ? by : h.claimedBy, ts: ctx.timestamp });
});

export const resolveHelp = spacetimedb.reducer({ id: t.u64(), note: t.string() }, (ctx, { id, note }) => {
  const h = ctx.db.helpRequest.id.find(id);
  if (!h) throw new SenderError('no such help request');
  ctx.db.helpRequest.id.update({ ...h, status: 'resolved', note, resolvedAt: ctx.timestamp });
});

export const logTalk = spacetimedb.reducer(
  {
    sessionId: t.string(),
    workerId: t.string(),
    said: t.string(),
    intent: t.string(),
    answer: t.string(),
    answeredBy: t.string(),
    latencyMs: t.u32(),
  },
  (ctx, args) => {
    ctx.db.talkEvent.insert({ id: 0n, ...args, ts: ctx.timestamp });
  }
);


// ═════════════ Layer A · identity ═════════════
type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
const ROLES = ['edge', 'supervisor', 'buddy', 'worker_screen'];
const EDGE_STALE_MICROS = 60_000_000n; // an edge app silent this long can be replaced (e.g. its token was lost)

function requireRole(ctx: Ctx, ...roles: string[]) {
  const d = ctx.db.device.identity.find(ctx.sender);
  if (!d || !roles.includes(d.role)) throw new SenderError(`only ${roles.join(' or ')} devices may do this`);
  return d;
}

export const registerDevice = spacetimedb.reducer(
  { role: t.string(), name: t.string(), workerId: t.string() },
  (ctx, { role, name, workerId }) => {
    if (!ROLES.includes(role)) throw new SenderError(`unknown role ${role}`);
    if (role === 'edge') {
      // exactly one trusted edge app writes coaching results
      for (const d of ctx.db.device.iter()) {
        if (d.role === 'edge' && !d.identity.equals(ctx.sender) && ctx.timestamp.microsSinceUnixEpoch - d.lastSeen.microsSinceUnixEpoch < EDGE_STALE_MICROS) {
          throw new SenderError('another edge app is active');
        }
      }
    }
    const row = { identity: ctx.sender, role, name: name.slice(0, 60), workerId: role === 'worker_screen' ? workerId : '', online: true, lastSeen: ctx.timestamp };
    if (ctx.db.device.identity.find(ctx.sender)) ctx.db.device.identity.update(row);
    else ctx.db.device.insert(row);
  }
);

export const heartbeat = spacetimedb.reducer((ctx) => {
  const d = ctx.db.device.identity.find(ctx.sender);
  if (d) ctx.db.device.identity.update({ ...d, online: true, lastSeen: ctx.timestamp });
});

// WebSocket clients (screens, phones): online exactly while connected.
export const onConnect = spacetimedb.clientConnected((ctx) => {
  const d = ctx.db.device.identity.find(ctx.sender);
  if (d && d.role !== 'edge') ctx.db.device.identity.update({ ...d, online: true, lastSeen: ctx.timestamp });
});

export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  const d = ctx.db.device.identity.find(ctx.sender);
  if (d && d.role !== 'edge') ctx.db.device.identity.update({ ...d, online: false, lastSeen: ctx.timestamp });
});

// The edge app speaks HTTP (no lasting connection): its heartbeat keeps it online; this sweep notices silence.
export const presenceSweep = spacetimedb.reducer({ onSchedule: presenceTimer }, { timer: presenceTimer.rowType }, (ctx) => {
  for (const d of ctx.db.device.iter()) {
    if (d.role === 'edge' && d.online && ctx.timestamp.microsSinceUnixEpoch - d.lastSeen.microsSinceUnixEpoch > 30_000_000n) {
      ctx.db.device.identity.update({ ...d, online: false });
    }
  }
  sweepCalls(ctx);
});

// Repeating jobs. init runs only when the database is created; ensureSchedules covers republishes.
function startSchedules(ctx: Ctx) {
  if (ctx.db.rollupTimer.count() === 0n) ctx.db.rollupTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(10_000_000n) });
  if (ctx.db.presenceTimer.count() === 0n) ctx.db.presenceTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(10_000_000n) });
}
export const init = spacetimedb.init((ctx) => startSchedules(ctx));
export const ensureSchedules = spacetimedb.reducer((ctx) => {
  requireRole(ctx, 'edge');
  startSchedules(ctx);
});

// ═════════════ Layer B · fading support ═════════════
const PROMOTE_STREAK = 3; // clean completions in a row → one step less support
const DEMOTE_ERRORS = 2; // errors among the last WINDOW outcomes → one step more support
const WINDOW = 5;
const OUTCOME_CODE: Record<string, string> = { clean: 'c', error: 'e', assisted: 'a' };

function masteryRow(ctx: Ctx, workerId: string, taskId: string, stepId: number) {
  const key = `${workerId}|${taskId}|${stepId}`;
  return ctx.db.mastery.key.find(key) ?? { key, workerId, taskId, stepId, level: 0, streak: 0, recent: '', attempts: 0, updatedAt: ctx.timestamp };
}

function saveMastery(ctx: Ctx, row: ReturnType<typeof masteryRow>) {
  if (ctx.db.mastery.key.find(row.key)) ctx.db.mastery.key.update(row);
  else ctx.db.mastery.insert(row);
}

// Called by the edge app when a step is finished. Applies the fading rules atomically.
export const recordStepOutcome = spacetimedb.reducer(
  { sessionId: t.string(), workerId: t.string(), taskId: t.string(), stepId: t.u32(), outcome: t.string() },
  (ctx, { sessionId, workerId, taskId, stepId, outcome }) => {
    const edge = requireRole(ctx, 'edge');
    const code = OUTCOME_CODE[outcome];
    if (!code) throw new SenderError(`unknown outcome ${outcome}`);
    const m = masteryRow(ctx, workerId, taskId, stepId);
    const before = m.level;
    let level = before;
    let streak = code === 'c' ? m.streak + 1 : 0;
    let recent = (m.recent + code).slice(-WINDOW);
    let reason = '';
    if (code === 'c' && streak >= PROMOTE_STREAK && level < 3) {
      level += 1;
      reason = 'promote';
    } else if (code === 'e' && [...recent].filter((x) => x === 'e').length >= DEMOTE_ERRORS && level > 0) {
      level -= 1;
      reason = 'demote';
    }
    if (reason) {
      streak = 0;
      recent = ''; // a fresh window at the new level
    }
    saveMastery(ctx, { ...m, level, streak, recent, attempts: m.attempts + 1, updatedAt: ctx.timestamp });
    ctx.db.stepOutcome.insert({ id: 0n, sessionId, workerId, taskId, stepId, outcome, levelBefore: before, levelAfter: level, reason, by: edge.name, ts: ctx.timestamp });
    if (reason) ctx.db.levelChange.insert({ workerId, taskId, stepId, fromLevel: before, toLevel: level, reason, by: 'rules' });
    ctx.db.device.identity.update({ ...edge, online: true, lastSeen: ctx.timestamp });
  }
);

// The job coach can always override the rules (human in the loop).
export const setSupportLevel = spacetimedb.reducer(
  { workerId: t.string(), taskId: t.string(), stepId: t.u32(), level: t.u8() },
  (ctx, { workerId, taskId, stepId, level }) => {
    const coach = requireRole(ctx, 'supervisor');
    if (level > 3) throw new SenderError('level is 0 to 3');
    const m = masteryRow(ctx, workerId, taskId, stepId);
    if (m.level === level) return;
    saveMastery(ctx, { ...m, level, streak: 0, recent: '', updatedAt: ctx.timestamp });
    ctx.db.stepOutcome.insert({ id: 0n, sessionId: '', workerId, taskId, stepId, outcome: 'override', levelBefore: m.level, levelAfter: level, reason: 'coach', by: coach.name, ts: ctx.timestamp });
    ctx.db.levelChange.insert({ workerId, taskId, stepId, fromLevel: m.level, toLevel: level, reason: 'coach', by: coach.name });
  }
);

// Per-identity view: a worker's screen sees only that worker's mastery rows.
export const myMastery = spacetimedb.view(
  { name: 'my_mastery', public: true },
  t.array(mastery.rowType),
  (ctx) => {
    const d = ctx.db.device.identity.find(ctx.sender);
    if (!d || d.role !== 'worker_screen' || !d.workerId) return [];
    return [...ctx.db.mastery.workerId.filter(d.workerId)];
  }
);

// ═════════════ Layer C · help escalation ═════════════
const ESCALATE_AFTER_MICROS = 20_000_000n;

export const escalateHelp = spacetimedb.reducer({ onSchedule: helpEscalationTimer }, { timer: helpEscalationTimer.rowType }, (ctx, { timer }) => {
  const h = ctx.db.helpRequest.id.find(timer.helpId);
  const r = ctx.db.helpRoute.helpId.find(timer.helpId);
  if (h && r && h.status === 'open' && r.routedTo === 'buddy') {
    ctx.db.helpRoute.helpId.update({ ...r, routedTo: 'supervisor', escalatedAt: ctx.timestamp });
  }
});

// ═════════════ Layer D · rollups ═════════════
const DAY_MICROS = 86_400_000_000n;

export const rollup = spacetimedb.reducer({ onSchedule: rollupTimer }, { timer: rollupTimer.rowType }, (ctx) => {
  const now = ctx.timestamp.microsSinceUnixEpoch;
  const by = new Map<string, { levels: number[]; promotions7d: number; cleanLast24h: number }>();
  const get = (w: string) => {
    let v = by.get(w);
    if (!v) by.set(w, (v = { levels: [0, 0, 0, 0], promotions7d: 0, cleanLast24h: 0 }));
    return v;
  };
  for (const m of ctx.db.mastery.iter()) get(m.workerId).levels[Math.min(3, m.level)] += 1;
  for (const o of ctx.db.stepOutcome.iter()) {
    const age = now - o.ts.microsSinceUnixEpoch;
    if (o.reason === 'promote' && age < 7n * DAY_MICROS) get(o.workerId).promotions7d += 1;
    if (o.outcome === 'clean' && age < DAY_MICROS) get(o.workerId).cleanLast24h += 1;
  }
  for (const [workerId, v] of by) {
    const row = {
      workerId,
      stepsTracked: v.levels.reduce((a, b) => a + b, 0),
      atFull: v.levels[0], atCue: v.levels[1], atAlerts: v.levels[2], independent: v.levels[3],
      promotions7d: v.promotions7d, cleanLast24h: v.cleanLast24h, updatedAt: ctx.timestamp,
    };
    if (ctx.db.workerProgress.workerId.find(workerId)) ctx.db.workerProgress.workerId.update(row);
    else ctx.db.workerProgress.insert(row);
  }
  rollupAgents(ctx);
});

// ═════════════ Layer E · voice agent ═════════════
// Every write names a call; only the screen that started it may write to it, and only while it is live.
function ownLiveCall(ctx: Ctx, callId: string) {
  const c = ctx.db.agentCall.callId.find(callId);
  if (!c) throw new SenderError('no such call');
  if (!c.owner.equals(ctx.sender)) throw new SenderError('not your call');
  if (c.status !== 'live') throw new SenderError(`call is ${c.status}`);
  return c;
}

// A screen that vanished mid-conversation can't end its call. HTTP reducer calls also fire the connect /
// disconnect hooks, so "disconnected" alone proves nothing: a live call is dropped only when its owner is
// offline AND nothing was written to the call for 30 s.
const CALL_SILENT_MICROS = 30_000_000n;
function sweepCalls(ctx: Ctx) {
  const now = ctx.timestamp.microsSinceUnixEpoch;
  for (const c of [...ctx.db.agentCall.iter()]) {
    if (c.status !== 'live' || ctx.db.device.identity.find(c.owner)?.online) continue;
    let last = c.startedAt.microsSinceUnixEpoch;
    for (const r of ctx.db.agentTurn.callId.filter(c.callId)) if (r.ts.microsSinceUnixEpoch > last) last = r.ts.microsSinceUnixEpoch;
    for (const r of ctx.db.agentToolCall.callId.filter(c.callId)) if (r.ts.microsSinceUnixEpoch > last) last = r.ts.microsSinceUnixEpoch;
    if (now - last > CALL_SILENT_MICROS) ctx.db.agentCall.callId.update({ ...c, status: 'dropped', endReason: 'dropped', endedAt: ctx.timestamp });
  }
}

export const agentCallStart = spacetimedb.reducer(
  { callId: t.string(), sessionId: t.string(), taskId: t.string(), agentVersion: t.string(), voice: t.string() },
  (ctx, { callId, sessionId, taskId, agentVersion, voice }) => {
    const d = requireRole(ctx, 'worker_screen');
    if (!d.workerId) throw new SenderError('register this screen for a worker first');
    if (ctx.db.agentCall.callId.find(callId)) throw new SenderError('call exists');
    // one live conversation per screen: a new call closes a stale one (e.g. a reload mid-call)
    for (const c of [...ctx.db.agentCall.owner.filter(ctx.sender)]) {
      if (c.status === 'live') ctx.db.agentCall.callId.update({ ...c, status: 'dropped', endReason: 'replaced', endedAt: ctx.timestamp });
    }
    ctx.db.agentCall.insert({
      callId, owner: ctx.sender, workerId: d.workerId, sessionId, taskId, agentVersion, voice: voice.slice(0, 60),
      status: 'live', endReason: '', turns: 0, toolCalls: 0, startedAt: ctx.timestamp, endedAt: undefined,
    });
  }
);

export const agentTurnLog = spacetimedb.reducer(
  { callId: t.string(), turn: t.u32(), role: t.string(), text: t.string(), interrupted: t.bool(), responseMs: t.u32() },
  (ctx, { callId, turn, role, text, interrupted, responseMs }) => {
    const c = ownLiveCall(ctx, callId);
    if (role !== 'user' && role !== 'assistant') throw new SenderError('role is user or assistant');
    ctx.db.agentTurn.insert({ id: 0n, callId, workerId: c.workerId, turn, role, text: text.slice(0, 2000), interrupted, responseMs: role === 'assistant' ? responseMs : 0, ts: ctx.timestamp });
    ctx.db.agentCall.callId.update({ ...c, turns: c.turns + 1 });
  }
);

export const agentToolLog = spacetimedb.reducer(
  { callId: t.string(), toolCallId: t.string(), tool: t.string(), argsJson: t.string(), result: t.string(), ok: t.bool(), latencyMs: t.u32() },
  (ctx, { callId, toolCallId, tool, argsJson, result, ok, latencyMs }) => {
    const c = ownLiveCall(ctx, callId);
    ctx.db.agentToolCall.insert({ id: 0n, callId, workerId: c.workerId, toolCallId, tool, argsJson: argsJson.slice(0, 1000), result: result.slice(0, 2000), ok, latencyMs, ts: ctx.timestamp });
    ctx.db.agentCall.callId.update({ ...c, toolCalls: c.toolCalls + 1 });
  }
);

export const agentCallEnd = spacetimedb.reducer({ callId: t.string(), reason: t.string() }, (ctx, { callId, reason }) => {
  const c = ctx.db.agentCall.callId.find(callId);
  if (!c || !c.owner.equals(ctx.sender)) throw new SenderError('not your call');
  if (c.status !== 'live') return; // already closed (the coach ended it, or the disconnect hook did)
  ctx.db.agentCall.callId.update({ ...c, status: 'ended', endReason: reason.slice(0, 40), endedAt: ctx.timestamp });
});

// Human in the loop: the job coach can end any conversation from the floor. The worker screen is
// subscribed to its call row and hangs up the moment the status flips.
export const coachEndCall = spacetimedb.reducer({ callId: t.string() }, (ctx, { callId }) => {
  const coach = requireRole(ctx, 'supervisor');
  const c = ctx.db.agentCall.callId.find(callId);
  if (!c) throw new SenderError('no such call');
  if (c.status === 'live') ctx.db.agentCall.callId.update({ ...c, status: 'ended', endReason: `coach:${coach.name}`.slice(0, 40), endedAt: ctx.timestamp });
});

// Per-identity views: the transcript and tool calls exist for supervisor devices only.
function isSupervisor(ctx: { sender: Identity; db: { device: { identity: { find: (i: Identity) => { role: string } | null | undefined } } } }) {
  return ctx.db.device.identity.find(ctx.sender)?.role === 'supervisor';
}

export const supervisorTranscript = spacetimedb.view({ name: 'supervisor_transcript', public: true }, t.array(agentTurn.rowType), (ctx) =>
  isSupervisor(ctx) ? [...ctx.db.agentTurn.iter()] : []
);

export const supervisorToolCalls = spacetimedb.view({ name: 'supervisor_tool_calls', public: true }, t.array(agentToolCall.rowType), (ctx) =>
  isSupervisor(ctx) ? [...ctx.db.agentToolCall.iter()] : []
);

function pct(xs: number[], p: number) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

function rollupAgents(ctx: Ctx) {
  const by = new Map<string, { calls: number; live: number; turns: number; tools: number; checks: number; help: number; barge: number; resp: number[]; toolMs: number[] }>();
  const get = (w: string) => {
    let v = by.get(w);
    if (!v) by.set(w, (v = { calls: 0, live: 0, turns: 0, tools: 0, checks: 0, help: 0, barge: 0, resp: [], toolMs: [] }));
    return v;
  };
  for (const c of ctx.db.agentCall.iter()) {
    const v = get(c.workerId);
    v.calls += 1;
    if (c.status === 'live') v.live += 1;
  }
  for (const r of ctx.db.agentTurn.iter()) {
    const v = get(r.workerId);
    v.turns += 1;
    if (r.interrupted) v.barge += 1;
    if (r.role === 'assistant' && r.responseMs > 0) v.resp.push(r.responseMs);
  }
  for (const r of ctx.db.agentToolCall.iter()) {
    const v = get(r.workerId);
    v.tools += 1;
    if (r.tool === 'check_my_work') v.checks += 1;
    if (r.tool === 'call_a_helper' && r.ok) v.help += 1;
    v.toolMs.push(r.latencyMs);
  }
  for (const [workerId, v] of by) {
    const row = {
      workerId, calls: v.calls, live: v.live, turns: v.turns, toolCalls: v.tools, checks: v.checks, helpAlerts: v.help, bargeIns: v.barge,
      p50ResponseMs: pct(v.resp, 0.5), p90ResponseMs: pct(v.resp, 0.9), p50ToolMs: pct(v.toolMs, 0.5), updatedAt: ctx.timestamp,
    };
    if (ctx.db.agentStats.workerId.find(workerId)) ctx.db.agentStats.workerId.update(row);
    else ctx.db.agentStats.insert(row);
  }
}
