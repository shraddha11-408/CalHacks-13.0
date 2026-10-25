// Edge API client (FastAPI on :8000 via the /api proxy). Keys never reach the browser.
import type { Say } from './audio'
import type { TriggerConfig } from './triggers'

export interface Step {
  id: number
  start_s?: number
  end_s?: number
  instruction: string
  done_right: string
  common_mistake: string
  correction: string
  why: string
  reference_photo: string
  praise?: string
  cue?: string
  close_look?: boolean
}

export interface Task {
  task_id: string
  title: string
  summary?: string
  source?: { kind: string; video_id: string; name: string }
  steps: Step[]
  frames?: string[]
  saved?: boolean
  /** consented clone of the supervisor's voice (Cartesia), if any */
  voice?: { id: string; name: string; consent_by: string; consent_at: number } | null
}

export interface VideoAnalysis {
  video_id: string
  name: string
  created_at: number
  duration: number
  video_url: string | null
  transcript: { start: number; end: number; text: string }[]
  transcript_clean: string
  frames: { t: number; url: string }[]
  faces_blurred: number
  tasks: Task[]
  audio_ok: boolean
  timings_ms: Record<string, number>
  raw_video_deleted: boolean
}

export interface VideoJob {
  job_id: string
  video_id: string
  name: string
  stage: 'queued' | 'transcribing' | 'cloning_voice' | 'key_frames' | 'claude' | 'saving' | 'recording_voice' | 'done' | 'failed'
  stages_ms: Record<string, number>
  error: string | null
  voice_error?: string | null
  result: VideoAnalysis | null
}

export interface PublicConfig {
  coach: TriggerConfig & { live_interval_s: number; live_parallel: number; live_snapshot_px: number; mark_with: 'live' | 'claude' | 'bitdeer'; done_min_gap_s: number; low_confidence: number; snapshot_px: number; keyframe_min_gap_s: number; keyframes_max: number; check_timeout_s: number }
  spacetimedb: { uri: string; db: string; ok: boolean }
  /** the cloned voice every phrase is spoken in (task's clone, else the latest consented clone) */
  voice_id?: string | null
  phrases: Record<string, Say>
}

export interface Memory {
  id: string
  text: string
  score?: number
  kind?: string
  tip?: string
}

export interface StepPayload {
  session_id: string
  index: number
  total: number
  step: Step
  say: Say[]
  memory: Memory[]
  memory_ms: number
  finished: boolean
  /** support level of this step (0 full … 3 independent), from SpacetimeDB */
  level?: number
  levels?: Record<string, number>
}

export interface CheckResult {
  status: 'done' | 'confirming' | 'mistake' | 'in_progress' | 'unclear' | 'unavailable' | 'skipped' | 'finished' | 'stale' | 'rate_limited'
  confidence: number
  reason: string
  source: string
  latency_ms: number
  escalated: boolean
  trigger: string
  say: Say[]
  finished?: boolean
  next?: StepPayload
  /** mistake only: [x, y, w, h] as fractions of the snapshot (= the work area) */
  box?: number[] | null
  fix?: string
  /** mistake only: saved photo (edge path) when the correction was spoken */
  photo?: string
  step_index?: number
  /** mistake seen again inside the 10 s cooldown: not spoken, not logged as a new mistake */
  repeat?: boolean
  /** the next small action for this step, from what the camera sees */
  hint?: string
  /** "stuck": this answer is stuck guidance */
  coach?: string
}

export interface ReportStats {
  sessions: number
  mistakes_total: number
  help_requests: number
  help: { step: string; status: string; when: string }[]
  tasks: {
    task_id: string
    title: string
    times_done: number
    times_finished: number
    mistakes_total: number
    mistakes_per_attempt: number[]
    trend: 'improving' | 'steady' | 'more_mistakes_lately' | 'not_enough_data'
    hardest_steps: { step: string; mistakes: number }[]
    attempts: { session_id: string; started_at: string; finished: boolean; steps_done: number; steps_total: number; mistakes: number; minutes: number | null; mistake_notes: { step: string; what: string }[] }[]
  }[]
}

export interface WorkerReport {
  worker: string
  stats: ReportStats
  notes: string[]
  report: { summary: string; strengths: string[]; needs_support: string[]; improvement: string; recommendations: string[]; for_worker: string } | null
  latency_ms: number
  generated_at: number
}

export interface Progress {
  text: string
  say: Say[]
  numbers: { task: string; total_steps: number; steps_done: number; by_self: number; corrections: number; minutes: number | null; times_done: number; last_time: { by_self: number; corrections: number; minutes: number | null } | null }
  memory: string[]
  worded_by: string
}

export interface AgentSession {
  agent_id: string
  url: string
  token: string
  voice: { id: string; name: string; cloned: boolean }
}

export interface AgentToolResult {
  result: string
  ok: boolean
  ui: { check?: CheckResult; help?: boolean; goto?: number }
  latency_ms: number
}

export interface TalkResult {
  said: string
  intent: string
  answer: string
  answered_by: string
  latency_ms: number
  say: Say[]
  check?: CheckResult
  help?: boolean
}

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = r.statusText
    try {
      msg = (await r.json()).detail ?? msg
    } catch {
      /* not json */
    }
    throw new Error(msg)
  }
  return r.json()
}

/** Droid calls keep the HTTP status so the UI can say "already on it" (409) or "not ready yet" (404). */
export class DroidHttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
async function droidFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api${path}`, init)
  if (!r.ok) {
    let msg = r.statusText
    try { const b = await r.json(); msg = typeof b.detail === 'string' ? b.detail : msg } catch { /* not json */ }
    throw new DroidHttpError(r.status, msg)
  }
  return r.json()
}
const droidPost = <T>(path: string, body: unknown = {}) => droidFetch<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const post = <T>(path: string, body: unknown) => fetch(`/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(j<T>)

export const api = {
  droidReteach: (taskId: string, stepId: number, reason?: string) => droidPost<{ job_id: string }>('/droid/reteach', { task_id: taskId, step_id: stepId, trigger: 'supervisor', ...(reason ? { reason } : {}) }),
  droidJobs: () => droidFetch<unknown[]>('/droid/jobs'),
  droidApprove: (id: string) => droidPost<unknown>(`/droid/jobs/${encodeURIComponent(id)}/approve`),
  droidReject: (id: string) => droidPost<unknown>(`/droid/jobs/${encodeURIComponent(id)}/reject`),
  config: (taskId?: string) => fetch(`/api/public-config${taskId ? `?task_id=${encodeURIComponent(taskId)}` : ''}`).then(j<PublicConfig>),
  tasks: () => fetch('/api/tasks').then(j<{ task_id: string; title: string; steps: number }[]>),
  task: (id: string) => fetch(`/api/tasks/${id}`).then(j<Task>),
  teach: (title: string, frames: string[]) => post<Task & { latency_ms: number }>('/teach/steps', { title, frames }),
  saveTask: (id: string, title: string, steps: Step[]) =>
    fetch(`/api/tasks/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, steps }) }).then(j<Task & { audio_ok: boolean; audio_error: string | null; audio_ms: number }>),
  start: (worker_name: string, task_id: string) => post<StepPayload & { task: { task_id: string; title: string }; worker_id: string }>('/coach/start', { worker_name, task_id }),
  check: (sid: string, image: string, trigger: string) => post<CheckResult>(`/coach/${sid}/check`, { image, trigger }),
  next: (sid: string, reason = 'button') => post<CheckResult>(`/coach/${sid}/next`, { reason }),
  help: (sid: string, image: string | null) => post<{ say: Say[]; photo: string }>(`/coach/${sid}/help`, { image }),
  goto: (sid: string, index: number) => post<StepPayload>(`/coach/${sid}/goto`, { index }),
  locate: (sid: string, image: string, reason: string) => post<{ box: number[] | null; fix: string; latency_ms: number }>(`/coach/${sid}/locate`, { image, reason }),
  end: (sid: string) => post<{ ok: boolean }>(`/coach/${sid}/end`, {}),
  workerId: (name: string) => fetch(`/api/worker-id?name=${encodeURIComponent(name)}`).then(j<{ worker_id: string }>),
  progress: (sid: string) => fetch(`/api/coach/${sid}/progress`).then(j<Progress>),
  talk: (sid: string, audio: Blob, image: string) => {
    const f = new FormData()
    f.append('audio', audio, audio.type.includes('mp4') ? 'talk.mp4' : 'talk.webm')
    f.append('image', image)
    return fetch(`/api/coach/${sid}/talk`, { method: 'POST', body: f }).then(j<TalkResult>)
  },
  agent: (sid: string) => post<AgentSession>(`/coach/${sid}/agent`, {}),
  agentTool: (sid: string, tool: string, parameters: Record<string, unknown>, image = '') => post<AgentToolResult>(`/coach/${sid}/agent/tool`, { tool, parameters, image }),
  label: (image: string, task_id: string, step_id: number, label: string) => post<{ saved: string; count: number }>('/testset', { image, task_id, step_id, label }),
  videoDemo: () => fetch('/api/videos/demo').then(j<{ available: boolean; url?: string; name?: string; duration?: number }>),
  videos: () => fetch('/api/videos').then(j<{ video_id: string; name: string; created_at: number; tasks: { task_id: string; title: string; steps: number }[] }[]>),
  video: (id: string) => fetch(`/api/videos/${id}`).then(j<VideoAnalysis>),
  /** consentBy: the supervisor's name when they agreed to have their voice cloned from the video */
  analyzeDemo: (consentBy = '') => post<VideoJob>('/videos/analyze-demo', { consent_by: consentBy }),
  uploadVideo: (file: File, consentBy = '') => {
    const f = new FormData()
    f.append('file', file, file.name)
    f.append('consent_by', consentBy)
    return fetch('/api/videos/upload', { method: 'POST', body: f }).then(j<VideoJob>)
  },
  videoJob: (id: string) => fetch(`/api/videos/jobs/${id}`).then(j<VideoJob>),
  report: (body: { worker_name: string; sessions: unknown[]; events: unknown[]; help: unknown[] }) => post<WorkerReport>('/report', body),
  memory: (worker: string) => fetch(`/api/memory/${encodeURIComponent(worker)}`).then(j<{ worker_id: string; notes: Memory[]; error: string | null }>),
  addMemory: (worker: string, text: string) => post<{ ok: boolean }>(`/memory/${encodeURIComponent(worker)}`, { text }),
}
