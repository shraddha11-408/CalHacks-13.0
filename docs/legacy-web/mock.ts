// ALL data in this file is SIMULATED. Every component that renders it shows the
// SIMULATED ribbon. Later phases replace these exports with live SpacetimeDB /
// edge data of the same shape (see types.ts).
import type {
  Checker,
  CompileEvent,
  HealthState,
  HelpRequest,
  Session,
  StreamEvent,
  TaskSpec,
  TrayState,
  Worker,
} from './types'

export const IS_MOCK = true

export const COACH = { name: 'Coach Dana' }
export const BUDDY = { id: 'sam', name: 'Sam' }

export const TASK: TaskSpec = {
  task_id: 'amenity_tray_v1',
  title: 'Set up a guest amenity tray',
  steps: [
    {
      id: 's1',
      instruction: { full: 'Pick up the blue soap. Put it in the top-left slot.', cue: 'Soap, top left.', picture_card: 'frames/s1_ref.jpg' },
      success: 'A blue bar is inside the top-left slot.',
      region: 'slot_A',
      common_errors: [{ type: 'wrong_slot', correction: 'Almost. The soap goes in the top-left slot.' }],
      checkable_by_rule: true,
    },
    {
      id: 's2',
      instruction: { full: 'Pick up the green shampoo. Put it in the top-right slot.', cue: 'Shampoo, top right.', picture_card: 'frames/s2_ref.jpg' },
      success: 'A green bottle is inside the top-right slot.',
      region: 'slot_B',
      common_errors: [{ type: 'wrong_slot', correction: 'Almost. The shampoo goes in the top-right slot.' }],
      checkable_by_rule: true,
    },
    {
      id: 's3',
      instruction: { full: 'Pick up the yellow lotion. Put it in the bottom-left slot.', cue: 'Lotion, bottom left.', picture_card: 'frames/s3_ref.jpg' },
      success: 'A yellow bottle is inside the bottom-left slot.',
      region: 'slot_C',
      common_errors: [
        { type: 'wrong_slot', correction: 'Almost. The lotion goes in the bottom-left slot.' },
        { type: 'wrong_item', correction: 'Almost. Use the yellow bottle. That one is the lotion.' },
      ],
      checkable_by_rule: true,
    },
    {
      id: 's4',
      instruction: { full: 'Fold the white washcloth in half. Put it in the bottom-right slot.', cue: 'Fold the cloth.', picture_card: 'frames/s4_ref.jpg' },
      success: 'A folded white cloth is inside the bottom-right slot.',
      region: 'slot_D',
      common_errors: [{ type: 'not_folded', correction: 'Almost. Fold the cloth one more time.' }],
      checkable_by_rule: false,
    },
    {
      id: 's5',
      instruction: { full: 'Slide the tray to the done mark.', cue: 'Tray to done.', picture_card: 'frames/s5_ref.jpg' },
      success: 'The tray sits on the done mark.',
      region: 'done_mark',
      common_errors: [],
      checkable_by_rule: true,
    },
  ],
}

/** Tray contents after each step k (index = steps completed). */
export const TRAY_AFTER: TrayState[] = [
  {},
  { slot_A: 'soap' },
  { slot_A: 'soap', slot_B: 'shampoo' },
  { slot_A: 'soap', slot_B: 'shampoo', slot_C: 'lotion' },
  { slot_A: 'soap', slot_B: 'shampoo', slot_C: 'lotion', slot_D: 'cloth' },
  { slot_A: 'soap', slot_B: 'shampoo', slot_C: 'lotion', slot_D: 'cloth' },
]

export const WORKERS: Worker[] = [
  {
    id: 'jordan', name: 'Jordan', task_id: TASK.task_id, step_index: 2, support_level: 1, help: 'none', online: true,
    last_verdict: { step_id: 's2', status: 'done', error_type: null, confidence: 0.96, tier: 'checker', latency_ms: 14, cost_usd: 0 },
  },
  {
    id: 'maya', name: 'Maya', task_id: TASK.task_id, step_index: 3, support_level: 0, help: 'open', online: true,
    last_verdict: { step_id: 's4', status: 'not_done', error_type: null, confidence: 0.62, tier: 'claude', latency_ms: 2140, cost_usd: 0.0041 },
  },
  {
    id: 'luis', name: 'Luis', task_id: TASK.task_id, step_index: 2, support_level: 2, help: 'none', online: true,
    last_verdict: { step_id: 's3', status: 'wrong', error_type: 'wrong_slot', confidence: 0.88, tier: 'bitdeer', latency_ms: 1180, cost_usd: 0.0006 },
  },
  {
    id: 'priya', name: 'Priya', task_id: TASK.task_id, step_index: 4, support_level: 3, help: 'claimed', online: true,
    last_verdict: { step_id: 's4', status: 'done', error_type: null, confidence: 0.91, tier: 'bitdeer', latency_ms: 960, cost_usd: 0.0006 },
  },
  {
    id: 'theo', name: 'Theo', task_id: TASK.task_id, step_index: 0, support_level: 0, help: 'none', online: false,
    last_verdict: null,
  },
]

export const HELP_REQUESTS: HelpRequest[] = [
  {
    id: 'h1', worker_id: 'maya', worker_name: 'Maya', step_id: 's4', step_label: 'Fold the cloth',
    opened_s_ago: 12, status: 'open', routed_to: 'buddy', claimed_by: null,
    tray: { slot_A: 'soap', slot_B: 'shampoo', slot_C: 'lotion' },
  },
  {
    id: 'h2', worker_id: 'priya', worker_name: 'Priya', step_id: 's4', step_label: 'Fold the cloth',
    opened_s_ago: 48, status: 'claimed', routed_to: 'buddy', claimed_by: 'Sam',
    tray: { slot_A: 'soap', slot_B: 'shampoo', slot_C: 'lotion', slot_D: 'cloth' },
  },
  {
    id: 'h3', worker_id: 'luis', worker_name: 'Luis', step_id: 's3', step_label: 'Lotion, bottom left',
    opened_s_ago: 26, status: 'open', routed_to: 'supervisor', claimed_by: null,
    tray: { slot_A: 'soap', slot_B: 'shampoo', slot_D: 'lotion' },
  },
]

export const CHECKERS: Checker[] = [
  { step_id: 's1', label: 'Soap, top left', version: 2, status: 'deployed', agree_count: 14 },
  { step_id: 's2', label: 'Shampoo, top right', version: 1, status: 'deployed', agree_count: 11 },
  { step_id: 's3', label: 'Lotion, bottom left', version: 1, status: 'shadow', agree_count: 6 },
  { step_id: 's5', label: 'Tray to done', version: 1, status: 'testing', agree_count: 0 },
]

export const COMPILE_LOG: CompileEvent[] = [
  { ts: '21:42:03', kind: 'plan', text: 'plan: s3 "lotion in slot_C" → region(slot_C) + color_fraction(yellow) ≥ 0.18; wrong_slot if yellow in slot_D' },
  { ts: '21:42:05', kind: 'tool', text: 'tool: read cvlib/README.md' },
  { ts: '21:42:07', kind: 'tool', text: 'tool: run python -c "inspect 12 training frames"' },
  { ts: '21:42:11', kind: 'diff', text: 'diff: + checkers/s3.py  (+34 −0)' },
  { ts: '21:42:12', kind: 'diff', text: 'diff: + checkers/test_s3.py  (+41 −0)' },
  { ts: '21:42:15', kind: 'pass', text: 'droid tests: 9 passed' },
  { ts: '21:42:16', kind: 'tool', text: 'runner: held-out set (8 frames Droid never saw, incl. the deliberate mistake)' },
  { ts: '21:42:17', kind: 'pass', text: 'held-out: 8/8 correct → publish s3 v1 as shadow' },
  { ts: '21:42:20', kind: 'plan', text: 'plan: s5 "tray on done mark" → template_score(done_mark, ref) ≥ 0.7' },
  { ts: '21:42:24', kind: 'fail', text: 'held-out: 6/8 correct (2 negatives missed) → retry with marker-offset rule' },
]

export const EVENTS: StreamEvent[] = [
  { ts: '21:44:31', worker: 'Jordan', text: 'Shampoo, top right → done', tier: 'checker', latency_ms: 14, status: 'done' },
  { ts: '21:44:28', worker: 'Maya', text: 'Help sent to Sam', status: 'unclear' },
  { ts: '21:44:22', worker: 'Maya', text: 'Fold the cloth → not yet', tier: 'claude', latency_ms: 2140, status: 'not_done' },
  { ts: '21:44:19', worker: 'Jordan', text: 'Asked "what now?" → coach phrasing', tier: 'moss', latency_ms: 4 },
  { ts: '21:44:12', worker: 'Luis', text: 'Lotion → almost (wrong slot)', tier: 'bitdeer', latency_ms: 1180, status: 'wrong' },
  { ts: '21:44:05', worker: 'Priya', text: 'Fold the cloth → done', tier: 'bitdeer', latency_ms: 960, status: 'done' },
  { ts: '21:43:58', worker: 'Jordan', text: 'Soap, top left → done', tier: 'checker', latency_ms: 11, status: 'done' },
]

export const METRICS = {
  tier_mix: { checker: 0.61, bitdeer: 0.31, claude: 0.08 },
  p50_ms: 38,
  p99_ms: 1910,
  cost_per_check_usd: 0.00052,
  false_correction_rate: 0.012,
  moss_no_model_share: 0.87,
  moss_p50_ms: 4,
}

export const LAST_MOSS_ANSWER = { question: 'what now?', answer: 'Lotion goes bottom left. Yellow bottle.', latency_ms: 4, worker: 'Jordan' }

export const TASK_LIBRARY = [
  ...TASK.steps.map((s, i) => ({ task_id: TASK.task_id, task: TASK.title, step_id: s.id, step_index: i, text: s.instruction.full, success: s.success })),
  { task_id: 'linen_cart_v1', task: 'Stock the linen cart', step_id: 's1', step_index: 0, text: 'Put the towels on the top shelf.', success: 'Towels are on the top shelf.' },
  { task_id: 'linen_cart_v1', task: 'Stock the linen cart', step_id: 's2', step_index: 1, text: 'Put the pillowcases in the bin.', success: 'Pillowcases are in the bin.' },
]

export const SESSIONS: Session[] = [
  {
    id: 'sess_014', worker: 'Jordan', task: TASK.title, started: 'Today 21:30', duration_min: 6, prompts: 4,
    events: [
      { ts: '21:30:02', worker: 'Jordan', text: 'Session started', status: 'unclear' },
      { ts: '21:30:40', worker: 'Jordan', text: 'Soap, top left → done', tier: 'checker', latency_ms: 12, status: 'done' },
      { ts: '21:31:25', worker: 'Jordan', text: 'Shampoo, top right → done', tier: 'checker', latency_ms: 15, status: 'done' },
      { ts: '21:32:10', worker: 'Jordan', text: 'Lotion → almost (wrong slot)', tier: 'bitdeer', latency_ms: 1210, status: 'wrong' },
      { ts: '21:32:31', worker: 'Jordan', text: 'Lotion, bottom left → done', tier: 'checker', latency_ms: 13, status: 'done' },
      { ts: '21:33:50', worker: 'Jordan', text: 'Fold the cloth → done', tier: 'claude', latency_ms: 2080, status: 'done' },
      { ts: '21:34:12', worker: 'Jordan', text: 'Tray to done → done', tier: 'bitdeer', latency_ms: 990, status: 'done' },
    ],
  },
  { id: 'sess_013', worker: 'Maya', task: TASK.title, started: 'Today 20:55', duration_min: 9, prompts: 11, events: [] },
  { id: 'sess_012', worker: 'Luis', task: TASK.title, started: 'Today 20:20', duration_min: 7, prompts: 6, events: [] },
]
// Sessions without scripted events replay the first session's shape.
for (const s of SESSIONS) if (!s.events.length) s.events = SESSIONS[0].events.map((e) => ({ ...e, worker: s.worker }))

export const HEALTH: { name: string; state: HealthState }[] = [
  { name: 'Camera (webcam)', state: 'ok' },
  { name: 'Mic (laptop)', state: 'ok' },
  { name: 'Speaker (laptop)', state: 'ok' },
  { name: 'Wrist (keyboard)', state: 'off' },
  { name: 'Bitdeer', state: 'off' },
  { name: 'Claude', state: 'off' },
  { name: 'Cartesia', state: 'off' },
  { name: 'Moss', state: 'off' },
  { name: 'SpacetimeDB', state: 'off' },
]

/** Scripted worker-view loop: what the voice says and which tier decided. */
export const WORKER_SCRIPT: { step_index: number; tier: 'checker' | 'bitdeer' | 'claude' | 'moss'; latency_ms: number; said: string; status: 'done' | 'wrong' | 'not_done' | 'ask' }[] = [
  { step_index: 2, tier: 'checker', latency_ms: 13, said: 'Pick up the yellow lotion. Put it in the bottom-left slot.', status: 'not_done' },
  { step_index: 2, tier: 'bitdeer', latency_ms: 1170, said: 'Almost. The lotion goes in the bottom-left slot.', status: 'wrong' },
  { step_index: 2, tier: 'moss', latency_ms: 4, said: 'Lotion goes bottom left. Yellow bottle.', status: 'ask' },
  { step_index: 3, tier: 'checker', latency_ms: 12, said: 'Fold the white washcloth in half. Put it in the bottom-right slot.', status: 'done' },
  { step_index: 3, tier: 'claude', latency_ms: 2050, said: 'Almost. Fold the cloth one more time.', status: 'wrong' },
  { step_index: 4, tier: 'claude', latency_ms: 1980, said: 'Slide the tray to the done mark.', status: 'done' },
]

export const TEACH_TRANSCRIPT = [
  { t: '0:02', text: 'Okay, we are setting up a guest tray.' },
  { t: '0:06', text: 'First the blue soap goes in the top-left slot.' },
  { t: '0:14', text: 'Then the green shampoo, top right.' },
  { t: '0:21', text: 'Now watch — lotion in the bottom-right. This is wrong.' },
  { t: '0:27', text: 'Lotion goes bottom left. Yellow bottle.' },
  { t: '0:35', text: 'Fold the washcloth in half and put it bottom right.' },
  { t: '0:44', text: 'Last, slide the tray to the done mark.' },
]

export const KEYFRAMES: { t: string; tray: TrayState; label: string; mistake?: boolean }[] = [
  { t: '0:09', tray: TRAY_AFTER[1], label: 'Soap placed' },
  { t: '0:17', tray: TRAY_AFTER[2], label: 'Shampoo placed' },
  { t: '0:24', tray: { slot_A: 'soap', slot_B: 'shampoo', slot_D: 'lotion' }, label: 'Mistake: lotion bottom right', mistake: true },
  { t: '0:30', tray: TRAY_AFTER[3], label: 'Lotion placed' },
  { t: '0:40', tray: TRAY_AFTER[4], label: 'Cloth folded' },
  { t: '0:47', tray: TRAY_AFTER[5], label: 'Tray on done mark' },
]

export const CONSENT = {
  person: 'Coach Dana (teammate playing the coach)',
  statement_recorded: true,
  statement_at: 'Today 19:12',
  sample_recorded: true,
  sample_seconds: 42,
  clone_status: 'ready' as 'not_started' | 'processing' | 'ready' | 'failed',
  used_for: 'Guidance for Jordan only',
  worker_voice_on: true,
}

export const CONSENT_SCRIPT =
  'I agree to let Stepwise record my voice and make a copy of it. The copy will only be used to give job guidance to workers I coach. I can ask to delete it at any time.'

export const EVAL = {
  tiers: [
    { tier: 'checker' as const, precision: 0.98, recall: 0.91, false_corr: 0.004, p50: 12, p99: 41, cost: 0 },
    { tier: 'bitdeer' as const, precision: 0.93, recall: 0.89, false_corr: 0.021, p50: 1050, p99: 1720, cost: 0.0006 },
    { tier: 'claude' as const, precision: 0.96, recall: 0.94, false_corr: 0.009, p50: 1980, p99: 3400, cost: 0.0041 },
  ],
  bitdeer_models: [
    { model: 'vision-model-A (TBD)', precision: 0.93, p50: 1050, cost: 0.0006 },
    { model: 'vision-model-B (TBD)', precision: 0.9, p50: 780, cost: 0.0004 },
  ],
  moss: { p50: 4, p99: 9, no_model_share: 0.87, false_answer: 0.03, questions: 30 },
  /** Prompts per session, days 1–5. Simulated from scripted sessions. */
  fading: [12, 9, 6, 4, 2],
}
