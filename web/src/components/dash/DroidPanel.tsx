import { useEffect, useMemo, useRef, useState } from 'react'
import { useTable } from 'spacetimedb/react'
import { tables } from '../../module_bindings'
import { api, DroidHttpError, type Step } from '../../lib/api'
import '../../styles/droid.css'

/**
 * Droid, the re-teach engineer. Live SpacetimeDB rows (droid_job / droid_event) when the bindings exist,
 * otherwise the edge's GET /droid/jobs polled every 2 s. Approve / Reject go to the edge.
 */

export type DroidStatus = 'queued' | 'running' | 'proposed' | 'approved' | 'rejected' | 'failed'
export interface DroidEvent { key: string; kind: string; text: string }
export interface DroidJob {
  id: string
  taskId: string
  stepId: number
  trigger: string
  reason: string
  status: DroidStatus
  summary: string
  why: string
  steps: Partial<Step>[]
  createdAt: number
  events: DroidEvent[]
}

const ACTIVE: DroidStatus[] = ['queued', 'running', 'proposed']
export const isActive = (j: DroidJob) => ACTIVE.includes(j.status)

// SpacetimeDB tables for Droid may not be generated yet: look them up at load time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const T = tables as any
const LIVE_JOBS = T.droidJob as unknown
const LIVE_EVENTS = T.droidEvent as unknown
const EMPTY: readonly never[] = []
// the condition is a module constant, so the hook order never changes between renders
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const useLive = (tbl: unknown): readonly any[] => (tbl ? useTable(tbl as never)[0] : EMPTY) // eslint-disable-line react-hooks/rules-of-hooks

const asMs = (v: unknown): number => {
  if (v == null) return 0
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
  if (typeof v === 'string') { const n = Date.parse(v); return Number.isNaN(n) ? 0 : n }
  const o = v as { toDate?: () => Date }
  return o.toDate ? o.toDate().getTime() : 0
}
const STATUSES = new Set(['queued', 'running', 'proposed', 'approved', 'rejected', 'failed'])
const parseJson = (v: unknown): { steps?: Partial<Step>[]; why?: string } => {
  if (!v) return {}
  if (typeof v === 'object') return v as never
  try { return JSON.parse(String(v)) } catch { return {} }
}
const str = (v: unknown) => (v == null ? '' : String(v))

/** Accepts either the edge's JSON record (snake_case) or a SpacetimeDB row (camelCase). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normJob(r: any, events: DroidEvent[]): DroidJob {
  const prop = parseJson(r.proposal ?? r.proposed)
  const st = str(r.status)
  return {
    id: str(r.job_id ?? r.id),
    taskId: str(r.task_id ?? r.taskId),
    stepId: Number(r.step_id ?? r.stepId ?? 0),
    trigger: str(r.trigger) || 'supervisor',
    reason: str(r.reason),
    status: (STATUSES.has(st) ? st : 'queued') as DroidStatus,
    summary: str(r.summary),
    why: str(prop.why ?? r.why),
    steps: Array.isArray(prop.steps) ? prop.steps : Array.isArray(r.steps) ? r.steps : [],
    createdAt: asMs(r.created_at ?? r.createdAt),
    events,
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const normEvents = (list: any[] | undefined, jobId: string): DroidEvent[] =>
  (list ?? []).map((e, i) => ({ key: str(e.id ?? `${jobId}-${i}`), kind: str(e.kind), text: str(e.text) }))

/** One source of truth for the Dashboard (the panel and the re-teach buttons share it). */
export function useDroidJobs() {
  const liveJobs = useLive(LIVE_JOBS)
  const liveEvents = useLive(LIVE_EVENTS)
  const [http, setHttp] = useState<unknown[]>([])
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    let stop = false
    const tick = async () => {
      try {
        const r = await api.droidJobs()
        if (!stop) { setHttp(Array.isArray(r) ? r : []); setOffline(false) }
      } catch { if (!stop) setOffline(true) } // 404 while the edge route is not up yet: stay calm
    }
    tick()
    const t = setInterval(tick, 2000)
    return () => { stop = true; clearInterval(t) }
  }, [])
  const jobs = useMemo(() => {
    const out = new Map<string, DroidJob>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of http as any[]) {
      const j = normJob(r, normEvents(r.events, str(r.job_id ?? r.id)))
      out.set(j.id, j)
    }
    for (const r of liveJobs) {
      const id = str(r.id)
      const ev = liveEvents.filter((e) => e.jobId === id).sort((a, b) => Number(a.id) - Number(b.id))
      const j = normJob(r, normEvents(ev, id))
      const old = out.get(id)
      if (old && !j.events.length) j.events = old.events // table empty for this job: keep the HTTP copy
      out.set(id, j)
    }
    return [...out.values()].filter((j) => j.id).sort((a, b) => b.createdAt - a.createdAt)
  }, [http, liveJobs, liveEvents])
  return { jobs, offline }
}

const ago = (t: number) => {
  if (!t) return ''
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`
}

export interface DroidLookup { title: (t: string) => string; stepText: (t: string, s: number) => string }

export function DroidPanel({ jobs, offline, lookup }: { jobs: DroidJob[]; offline: boolean; lookup: DroidLookup }) {
  const taskRows = useLive(T.task)
  // only jobs for tasks that still exist (deleted test tasks and test rows stay out of the panel)
  const shown = (taskRows.length ? jobs.filter((j) => taskRows.some((r) => r.id === j.taskId)) : jobs).slice(0, 5)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const isOpen = (j: DroidJob, i: number) => (open.has(j.id) ? !(i === 0 || isActive(j)) : i === 0 || isActive(j))
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const currentStep = (j: DroidJob): Partial<Step> | undefined => {
    const row = taskRows.find((r) => r.id === j.taskId)
    if (!row) return undefined
    try { return (JSON.parse(row.stepsJson) as Step[]).find((s) => s.id === j.stepId) } catch { return undefined }
  }
  return (
    <div className="dr" data-droid-panel>
      {shown.length === 0 ? (
        <p className="dash-calm">
          No Droid jobs yet. Droid starts on its own when a step gets 2 corrections in an hour, or ask it from the re-teach list.
          {offline && <><br /><span className="sv-mono">Droid service is not reachable yet.</span></>}
        </p>
      ) : (
        <ul className="dr-jobs">
          {shown.map((j, i) => (
            <JobCard key={j.id} job={j} lookup={lookup} before={currentStep(j)} open={isOpen(j, i)} onToggle={() => toggle(j.id)} />
          ))}
        </ul>
      )}
    </div>
  )
}

function JobCard({ job, lookup, before, open, onToggle }: { job: DroidJob; lookup: DroidLookup; before?: Partial<Step>; open: boolean; onToggle: () => void }) {
  const [local, setLocal] = useState<{ from: DroidStatus; to: DroidStatus } | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  // optimistic status holds only until the server moves off "proposed"
  const status = local && job.status === local.from ? local.to : job.status
  const evRef = useRef<HTMLUListElement>(null)
  useEffect(() => { const el = evRef.current; if (el) el.scrollTop = el.scrollHeight }, [job.events.length, open])

  const act = async (kind: 'approve' | 'reject') => {
    setBusy(true); setErr('')
    setLocal({ from: job.status, to: kind === 'approve' ? 'approved' : 'rejected' })
    try {
      await (kind === 'approve' ? api.droidApprove(job.id) : api.droidReject(job.id))
    } catch (e) {
      setLocal(null)
      setErr(e instanceof DroidHttpError && e.status === 404 ? 'The Droid service is not ready yet. Nothing changed. Try again in a moment.' : `Nothing changed. ${(e as Error).message || 'Please try again.'}`)
    } finally { setBusy(false) }
  }

  const auto = job.trigger === 'auto'
  const stepLabel = lookup.stepText(job.taskId, job.stepId)
  const active = status === 'queued' || status === 'running'
  return (
    <li className={`dr-job ${active ? 'live' : ''}`}>
      <div className="dr-head">
        <div style={{ minWidth: 0, flex: '1 1 220px' }}>
          <p className="dr-title">“{stepLabel}”</p>
          <p className="dr-sub">{lookup.title(job.taskId)} · {job.id}</p>
        </div>
        <div className="dr-meta">
          <span className="dr-chip">{auto ? `Auto · ${job.reason || '2 corrections in an hour'}` : 'Supervisor'}</span>
          <span className={`dr-chip ${status}`}>{status === 'running' && <i className="dr-dot" aria-hidden />}{status}</span>
          <span>{ago(job.createdAt)}</span>
        </div>
      </div>

      <button type="button" className="dr-toggle" onClick={onToggle} aria-expanded={open} style={{ alignSelf: 'flex-start' }}>
        {open ? 'Hide Droid’s work' : `Show Droid’s work (${job.events.length})`}
      </button>
      {open && (
        job.events.length === 0 ? <p className="dr-none">Waiting for Droid’s first step…</p> : (
          <ul className="dr-events" ref={evRef} aria-label="Droid live events">
            {job.events
              // quieter stream: no bare "ok" tool results, no repeat of the line just shown
              .filter((e, i, a) => !(e.kind === 'tool_result' && /^ok$/i.test(e.text.trim())) && !(i > 0 && a[i - 1].text.trim() === e.text.trim()) && !(e.kind === 'final' && a.some((x) => x !== e && x.text.trim() === e.text.trim())))
              .map((e) => <li key={e.key} className={`dr-ev ${evClass(e)}`}>{e.text}</li>)}
          </ul>
        )
      )}

      {status === 'failed' && <p className="dr-err">{job.summary || 'Droid could not make a safe change. Nothing was changed.'}</p>}

      {(status === 'proposed' || status === 'approved' || status === 'rejected') && job.steps.length > 0 && (
        <>
          <div className="dr-cmp">
            <div className="dr-col" aria-label="Before">
              <h4>Before</h4>
              {before ? <StepView s={before} /> : <p className="dr-none">{stepLabel}</p>}
            </div>
            <div className="dr-col after" aria-label="After">
              <h4>After · {job.steps.length === 1 ? '1 step' : `${job.steps.length} steps`}</h4>
              {job.steps.map((s, i) => <StepView key={i} s={s} />)}
            </div>
          </div>
          {job.why && <p className="dr-why"><b>Why</b>{job.why}</p>}
        </>
      )}

      {status === 'proposed' && (
        <div className="dr-actions">
          <button type="button" className="dr-btn" disabled={busy} onClick={() => act('approve')}>Approve</button>
          <button type="button" className="dr-btn ghost" disabled={busy} onClick={() => act('reject')}>Reject</button>
          <span className="sv-mono">Nothing changes until you approve.</span>
        </div>
      )}
      {err && <p className="dr-err" role="status">{err}</p>}
    </li>
  )
}

function evClass(e: DroidEvent) {
  if (e.kind === 'check') return `check ${/pass/i.test(e.text) && !/fail/i.test(e.text) ? 'pass' : 'fail'}`
  return e.kind.replace(/[^a-z_]/gi, '')
}

function StepView({ s }: { s: Partial<Step> }) {
  return (
    <div className="dr-step">
      {s.instruction && <p><b>Say</b>{s.instruction}</p>}
      {s.correction && <p><b>Fix</b>{s.correction}</p>}
      {s.cue && <p><b>Cue</b>{s.cue}</p>}
      {s.close_look && <span className="dr-badge">close look</span>}
    </div>
  )
}

/** Small outline pill on each re-teach row. */
export function AskDroid({ taskId, stepId, jobs, onDone }: { taskId: string; stepId: number; jobs: DroidJob[]; onDone?: () => void }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [msg, setMsg] = useState('')
  const busyJob = jobs.some((j) => j.taskId === taskId && j.stepId === stepId && isActive(j))
  const click = async () => {
    setState('sending'); setMsg('')
    try { await api.droidReteach(taskId, stepId); setState('sent'); onDone?.() }
    catch (e) {
      setState('idle')
      setMsg(e instanceof DroidHttpError && e.status === 409 ? 'Droid is already on it' : e instanceof DroidHttpError && e.status === 404 ? 'Droid is not ready yet. Try again soon.' : (e as Error).message || 'Could not start Droid.')
    }
  }
  useEffect(() => { if (!busyJob && state === 'sent') setState('idle') }, [busyJob, state])
  const disabled = busyJob || state !== 'idle'
  return (
    <div className="dr-ask">
      {msg && <span role="status">{msg}</span>}
      <button type="button" className="dr-btn ghost" disabled={disabled} onClick={click}>
        {busyJob || state === 'sent' ? 'Droid is on it' : state === 'sending' ? 'Asking…' : 'Ask Droid to fix this step'}
      </button>
    </div>
  )
}
