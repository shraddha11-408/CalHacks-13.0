// Stepwise MVP live database (PLAN.md §5 "Event log"; SpacetimeDB replaces Convex).
// The edge app writes through reducers over HTTP; the supervisor dashboard
// subscribes with the TypeScript SDK. Photos live on the edge laptop; rows hold paths.
import { schema, table, t, SenderError } from 'spacetimedb/server';

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

const spacetimedb = schema({ worker, task, session, stepEvent, helpRequest, talkEvent });
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
    ctx.db.helpRequest.insert({ id: 0n, ...args, status: 'open', claimedBy: '', note: '', createdAt: ctx.timestamp, resolvedAt: undefined });
  }
);

// Atomic: the first claimer wins; a second claim on the same request fails.
export const claimHelp = spacetimedb.reducer({ id: t.u64(), by: t.string() }, (ctx, { id, by }) => {
  const h = ctx.db.helpRequest.id.find(id);
  if (!h) throw new SenderError('no such help request');
  if (h.status !== 'open') throw new SenderError(`already ${h.status} by ${h.claimedBy}`);
  ctx.db.helpRequest.id.update({ ...h, status: 'claimed', claimedBy: by });
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
