import { useMemo, useState } from 'react'
import { useReducer, useTable } from 'spacetimedb/react'
import { reducers, tables } from '../../module_bindings'
import { doubleClaims } from '../../lib/claims'
import '../../styles/dash.css'

/**
 * Supervisor dashboard. Every number is computed from live SpacetimeDB rows and answers one question
 * a job coach asks. Test / smoke-check rows are hidden unless "Include test data" is on.
 */

type Range = 'today' | '7d' | 'all'
const DAY = 86_400_000
const LEVEL_NAME = ['full help', 'short cues', 'alerts only', 'on their own']
const LEVEL_FILL = ['#dfe7e4', '#9fb3ae', '#4f7a74', '#0f3b3a']
const SERIES = ['#0f3b3a', '#6f8a4b', '#4f7a74', '#2a3133', '#9fb3ae', '#8a9a5b']
/** Help claimed within this many ms never reached the supervisor (buddy window). */
const BUDDY_WINDOW = 20_000
/** Assumed job-coach seconds per reminder or answer (walk over, get attention, say it). Labeled "estimate". */
const COACH_SECONDS_PER_PROMPT = 30

export interface DashLookup {
  title: (taskId: string) => string
  stepText: (taskId: string, stepId: number) => string
  taskCount: number
}

// ---------- test-data filter (one place) ----------
const TEST_RE = /test|smoke|speed ?check|fadetest|agent_smoke|race|esc-test|mobile_test|browser_test/i
const TEST_SESSION_RE = /^(race|esc)[_-]/i
/** True when an id/name looks like a script, smoke check or test run rather than a real worker. */
export function isTestData(...parts: (string | undefined | null)[]): boolean {
  return parts.some((p) => !!p && (TEST_RE.test(p) || TEST_SESSION_RE.test(p)))
}

const ms = (t: { toDate: () => Date }) => t.toDate().getTime()
const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : null)
const fmtSec = (x: number | null) => (x == null ? '—' : x < 1000 ? '< 1 s' : x < 60_000 ? `${Math.round(x / 1000)} s` : `${(x / 60_000).toFixed(1)} min`)
const fmtMin = (sec: number) => (sec < 60 ? `${Math.round(sec)} s` : sec < 3600 ? `${Math.round(sec / 60)} min` : `${(sec / 3600).toFixed(1)} h`)
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

type Trend = { text: string; tone: 'good' | 'bad' | 'flat' | 'none' }
/** Honest trend wording. `kind` = 'pts' compares percentages in points, 'rel' as a percent change. */
function trend(cur: number | null, prev: number | null, vs: string, opts: { kind: 'pts' | 'rel' | 'abs'; lowerIsBetter?: boolean; unit?: string }): Trend {
  if (!vs) return { text: 'All time, no comparison', tone: 'none' }
  if (cur == null) return { text: 'No data in this range yet', tone: 'none' }
  if (prev == null) return { text: `Nothing to compare with in the ${vs}`, tone: 'none' }
  let d: number
  let shown: string
  if (opts.kind === 'pts') { d = Math.round(cur - prev); shown = `${Math.abs(d)} pts` }
  else if (opts.kind === 'rel') {
    if (prev === 0) return { text: cur === 0 ? `Same as the ${vs}` : `Up from 0 in the ${vs}`, tone: cur === 0 ? 'flat' : opts.lowerIsBetter ? 'bad' : 'good' }
    d = Math.round((100 * (cur - prev)) / prev); shown = `${Math.abs(d)}%`
  } else { d = Math.round(cur - prev); shown = `${Math.abs(d)}${opts.unit ?? ''}` }
  if (d === 0) return { text: `Same as the ${vs}`, tone: 'flat' }
  const better = opts.lowerIsBetter ? d < 0 : d > 0
  return { text: `${d > 0 ? 'Up' : 'Down'} ${shown} from the ${vs}`, tone: better ? 'good' : 'bad' }
}

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

/** `showTest` (optional): when the page owns an "Include test data" switch, pass it here and the dashboard hides its own. */
export function Dashboard({ lookup, showTest }: { lookup: DashLookup; showTest?: boolean }) {
  const [outcomesRaw] = useTable(tables.stepOutcome)
  const [workersRaw] = useTable(tables.worker)
  const [masteryRaw] = useTable(tables.mastery)
  const [talkRaw] = useTable(tables.talkEvent)
  const [helpRaw] = useTable(tables.helpRequest)
  const [attemptsRaw] = useTable(tables.claimAttempt)
  const [routes] = useTable(tables.helpRoute)
  const [range, setRange] = useState<Range>('7d')
  const [who, setWho] = useState<string>('all')
  const [ownTest, setWithTest] = useState(false)
  const withTest = showTest ?? ownTest
  const [focus, setFocus] = useState<string | null>(null) // `${taskId}#${stepId}` in the re-teach list

  // ---- one filter for test data, applied to every table
  const testWorkers = useMemo(() => new Set(workersRaw.filter((w) => isTestData(w.id, w.name)).map((w) => w.id)), [workersRaw])
  const keepW = (workerId: string, sessionId?: string) => withTest || (!testWorkers.has(workerId) && !isTestData(workerId, sessionId))
  const workers = workersRaw.filter((w) => withTest || !testWorkers.has(w.id))
  const outcomesAll = outcomesRaw.filter((o) => keepW(o.workerId, o.sessionId))
  const mastery = masteryRaw.filter((m) => keepW(m.workerId))
  const talk = talkRaw.filter((t) => keepW(t.workerId, t.sessionId))
  const help = helpRaw.filter((h) => keepW(h.workerId, h.sessionId))
  const helpIds = new Set(help.map((h) => h.id))
  const attempts = attemptsRaw.filter((a) => helpIds.has(a.helpId))

  const now = Date.now()
  const span = range === 'today' ? DAY : range === '7d' ? 7 * DAY : Infinity
  const from = span === Infinity ? 0 : now - span
  const prevFrom = span === Infinity ? 0 : now - 2 * span
  const inW = (w: string) => who === 'all' || w === who
  const inCur = (t: number) => t >= from
  const inPrev = (t: number) => span !== Infinity && t >= prevFrom && t < from
  const name = (id: string) => workersRaw.find((w) => w.id === id)?.name ?? id
  const vs = range === 'today' ? 'day before' : range === '7d' ? 'previous 7 days' : ''

  const graded = outcomesAll.filter((o) => o.outcome !== 'override' && inW(o.workerId))
  const cur = graded.filter((o) => inCur(ms(o.ts)))
  const prev = graded.filter((o) => inPrev(ms(o.ts)))
  const curHelp = help.filter((h) => inW(h.workerId) && inCur(ms(h.createdAt)))
  const prevHelp = help.filter((h) => inW(h.workerId) && inPrev(ms(h.createdAt)))
  const curTalk = talk.filter((t) => inW(t.workerId) && inCur(ms(t.ts)))

  // ---- KPIs
  const clean = (xs: typeof cur) => pct(xs.filter((o) => o.outcome === 'clean').length, xs.length)
  const runs = (xs: typeof cur) => new Set(xs.filter((o) => o.sessionId).map((o) => o.sessionId)).size
  const remindersPerRun = (xs: typeof cur) => {
    const r = runs(xs)
    return r ? xs.filter((o) => o.outcome !== 'clean' && o.sessionId).length / r : null
  }
  const claimTimes = (hs: typeof help) =>
    hs.flatMap((h) => {
      const win = attempts.find((a) => a.helpId === h.id && a.won)
      const d = win ? ms(win.ts) - ms(h.createdAt) : -1
      return d >= 0 ? [d] : []
    })
  const curTimes = claimTimes(curHelp)
  const prevTimes = claimTimes(prevHelp)
  // Denominator is every request in range: an unclaimed request counts as not answered within 20 s.
  const within = pct(curTimes.filter((t) => t <= BUDDY_WINDOW).length, curHelp.length)
  const unanswered = curHelp.filter((h) => !attempts.some((a) => a.helpId === h.id && a.won)).length

  const myMastery = mastery.filter((m) => inW(m.workerId))
  const onOwn = myMastery.filter((m) => m.level === 3).length
  const alertsOnly = myMastery.filter((m) => m.level === 2).length
  const changes = outcomesAll.filter((o) => inW(o.workerId) && inCur(ms(o.ts)) && o.levelAfter !== o.levelBefore)
  const ups = changes.filter((o) => o.levelAfter > o.levelBefore)
  const downs = changes.filter((o) => o.levelAfter < o.levelBefore)

  // ---- re-teach list: steps with the most reminders / help this range
  const reteach = useMemo(() => {
    type Row = { key: string; taskId: string; stepId: number; error: number; assisted: number; help: number; clean: number; backs: number; workers: Map<string, number> }
    const m = new Map<string, Row>()
    const get = (t: string, s: number) => {
      const k = `${t}#${s}`
      const r = m.get(k) ?? { key: k, taskId: t, stepId: s, error: 0, assisted: 0, help: 0, clean: 0, backs: 0, workers: new Map() }
      m.set(k, r)
      return r
    }
    for (const o of cur) {
      const r = get(o.taskId, o.stepId)
      if (o.outcome === 'clean') { r.clean += 1; continue }
      if (o.outcome === 'error') r.error += 1
      else r.assisted += 1
      if (o.levelAfter < o.levelBefore) r.backs += 1
      r.workers.set(o.workerId, (r.workers.get(o.workerId) ?? 0) + 1)
    }
    for (const h of curHelp) {
      const r = get(h.taskId, h.stepId)
      r.help += 1
      r.workers.set(h.workerId, (r.workers.get(h.workerId) ?? 0) + 1)
    }
    return [...m.values()]
      .filter((r) => r.error + r.assisted + r.help > 0)
      .sort((a, b) => b.error * 2 + b.assisted + b.help * 2 + b.backs * 3 - (a.error * 2 + a.assisted + a.help * 2 + a.backs * 3))
      .slice(0, 6)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcomesRaw, helpRaw, range, who, withTest])
  const needsReteach = reteach.filter((r) => r.error >= 2 || r.backs > 0 || r.help >= 2)

  // Coach time saved (estimate): each reminder drigil gave + each question it answered is one a job coach would otherwise give.
  const promptsGiven = cur.filter((o) => o.outcome !== 'clean').length + curTalk.length
  const savedSec = promptsGiven * COACH_SECONDS_PER_PROMPT

  // ---- independence over time: per worker, per task run, % of steps with no reminder or help
  const series = useMemo(() => {
    const byRun = new Map<string, { w: string; t: number; clean: number; n: number }>()
    for (const o of cur) {
      if (!o.sessionId) continue
      const s = byRun.get(o.sessionId) ?? { w: o.workerId, t: ms(o.ts), clean: 0, n: 0 }
      s.n += 1
      if (o.outcome === 'clean') s.clean += 1
      s.t = Math.min(s.t, ms(o.ts))
      byRun.set(o.sessionId, s)
    }
    const per = new Map<string, { t: number; v: number; n: number }[]>()
    for (const s of byRun.values()) {
      const arr = per.get(s.w) ?? []
      arr.push({ t: s.t, v: Math.round((100 * s.clean) / s.n), n: s.n })
      per.set(s.w, arr)
    }
    return [...per.entries()].map(([w, pts]) => ({ w, pts: pts.sort((a, b) => a.t - b.t) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcomesRaw, range, who, withTest])

  const helpers = useMemo(() => {
    const by = new Map<string, number>()
    for (const a of attempts) {
      if (!a.won || !curHelp.some((h) => h.id === a.helpId)) continue
      const k = a.winner || a.by
      by.set(k, (by.get(k) ?? 0) + 1)
    }
    const escalated = curHelp.filter((h) => routes.find((r) => r.helpId === h.id)?.routedTo === 'supervisor').length
    const buckets = [
      { label: '< 10 s', n: curTimes.filter((t) => t < 10_000).length, late: false },
      { label: '10–20 s', n: curTimes.filter((t) => t >= 10_000 && t <= BUDDY_WINDOW).length, late: false },
      { label: '20–60 s', n: curTimes.filter((t) => t > BUDDY_WINDOW && t < 60_000).length, late: true },
      { label: '> 1 min', n: curTimes.filter((t) => t >= 60_000).length, late: true },
    ]
    return { by: [...by.entries()].sort((a, b) => b[1] - a[1]), buckets, escalated }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [helpRaw, attemptsRaw, routes, range, who, withTest])

  const voice = useMemo(() => {
    const fixed = curTalk.filter((t) => t.answeredBy === 'instant').length
    const askedHelp = curTalk.filter((t) => t.intent === 'help' || t.intent === 'stuck').length
    const lines: string[] = []
    for (const t of [...curTalk].sort((a, b) => ms(b.ts) - ms(a.ts))) {
      const a = t.answer.trim()
      if (a && a.length < 140 && !lines.includes(a)) lines.push(a)
      if (lines.length >= 4) break
    }
    const askers = new Set(curTalk.map((t) => t.workerId)).size
    return { n: curTalk.length, askers, fixed: pct(fixed, curTalk.length), askedHelp, p50: median(curTalk.map((t) => t.latencyMs)), lines }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [talkRaw, range, who, withTest])

  const cleanNow = clean(cur)
  const rpr = remindersPerRun(cur)
  const rprPrev = remindersPerRun(prev)
  const medCur = median(curTimes)
  const medPrev = median(prevTimes)
  const focusRow = reteach.find((r) => r.key === focus) ?? null
  const testHidden = !withTest && (workersRaw.length !== workers.length || helpRaw.length !== help.length || outcomesRaw.length !== outcomesAll.length)

  return (
    <section className="dash" aria-label="Dashboard">
      <div className="dash-filters" role="group" aria-label="Filters">
        <div className="dash-seg" role="radiogroup" aria-label="Time range">
          {(['today', '7d', 'all'] as Range[]).map((r) => (
            <button key={r} role="radio" aria-checked={range === r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>
              {r === 'today' ? 'Today' : r === '7d' ? '7 days' : 'All time'}
            </button>
          ))}
        </div>
        <div className="dash-filters-r">
          <label className="dash-select">
            <span className="sv-mono">Worker</span>
            <select value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="all">Everyone</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </label>
          {showTest === undefined && <label className="dash-toggle" title="Rows from smoke checks, speed checks and claim-race scripts are hidden by default.">
            <input type="checkbox" checked={withTest} onChange={(e) => setWithTest(e.target.checked)} />
            <span>Include test data</span>
          </label>}
        </div>
      </div>
      {testHidden && <p className="dash-note sv-mono">Test runs are hidden from every number below.</p>}

      <div className="dash-kpis">
        <Kpi
          label="Steps done on their own"
          value={cleanNow == null ? null : `${cleanNow}%`}
          sub={cur.length ? `${cur.filter((o) => o.outcome === 'clean').length} of ${plural(cur.length, 'step')}` : undefined}
          trend={trend(cleanNow, clean(prev), vs, { kind: 'pts' })}
          means="Share of finished steps with no correction, hint or help request."
          onClick={() => scrollTo('dash-indep')}
        />
        <Kpi
          label="Steps mastered"
          value={myMastery.length ? String(onOwn) : null}
          sub={myMastery.length ? `of ${myMastery.length} worker-steps · ${alertsOnly} more at alerts only` : undefined}
          trend={!changes.length ? { text: 'No level changes in this range', tone: 'none' } : { text: `${plural(ups.length, 'level-up')}, ${plural(downs.length, 'step back')} in this range`, tone: ups.length > downs.length ? 'good' : ups.length < downs.length ? 'bad' : 'flat' }}
          means="Worker-steps now at 'on their own': 3 clean runs in a row at each level got them there."
          onClick={() => scrollTo('dash-grid')}
        />
        <Kpi
          label="Reminders per task run"
          value={rpr == null ? null : rpr.toFixed(1)}
          sub={rpr == null ? undefined : `${plural(runs(cur), 'task run')}`}
          trend={trend(rpr, rprPrev, vs, { kind: 'rel', lowerIsBetter: true })}
          means="Corrections and hints drigil gave, divided by task runs. Lower means less support needed."
          onClick={() => scrollTo('dash-reteach')}
        />
        <Kpi
          label="Help arrives in"
          value={medCur == null ? null : fmtSec(medCur)}
          sub={within == null ? undefined : `${within}% of ${plural(curHelp.length, 'request')} claimed within 20 s${unanswered ? ` · ${unanswered} never claimed` : ''}`}
          trend={trend(medCur == null ? null : medCur / 1000, medPrev == null ? null : medPrev / 1000, vs, { kind: 'abs', lowerIsBetter: true, unit: ' s' })}
          means="Median time from 'I'm stuck' to a person claiming it. After 20 s it goes to the supervisor."
          help={unanswered > 0}
          onClick={() => scrollTo('dash-help')}
        />
        <Kpi
          label="Steps to re-teach"
          value={reteach.length || cur.length ? String(needsReteach.length) : null}
          sub={needsReteach[0] ? `Top: “${lookup.stepText(needsReteach[0].taskId, needsReteach[0].stepId)}”` : reteach.length ? 'Nothing repeated yet' : undefined}
          trend={{ text: needsReteach.length ? 'Tap to see which steps' : 'No step keeps going wrong', tone: needsReteach.length ? 'bad' : 'good' }}
          means="Steps with 2+ corrections, 2+ help requests, or a step back in support in this range."
          onClick={() => { if (needsReteach[0]) setFocus(needsReteach[0].key); scrollTo('dash-reteach') }}
        />
        <Kpi
          label="Coach time saved"
          tag="estimate"
          value={promptsGiven ? fmtMin(savedSec) : null}
          sub={promptsGiven ? `${promptsGiven} reminders and answers × ${COACH_SECONDS_PER_PROMPT} s` : undefined}
          trend={{ text: `Assumes ${COACH_SECONDS_PER_PROMPT} s of job-coach time per reminder`, tone: 'none' }}
          means={`Estimate: every correction, hint and answered question is one a job coach would otherwise give in person (${COACH_SECONDS_PER_PROMPT} s each, assumed).`}
          onClick={() => scrollTo('dash-voice')}
        />
      </div>

      <div className="dash-grid">
        <Panel id="dash-indep" className="span-8" title="Who is getting more independent?" sub="Each dot is one task run: the share of its steps done with no reminder or help. Tap a name to hide it.">
          <LineChart series={series} name={name} onPick={(w) => setWho(w)} />
        </Panel>
        <Panel id="dash-levels" className="span-4" title="What changed in their support?" sub="Support fades after 3 clean runs; it steps back after 2 errors in the last 5.">
          {changes.length === 0 ? (
            <Calm text="No support changes in this range yet. Three clean runs in a row moves a step up." />
          ) : (
            <ol className="dash-feed">
              {[...changes].sort((a, b) => ms(b.ts) - ms(a.ts)).slice(0, 10).map((o) => {
                const up = o.levelAfter > o.levelBefore
                return (
                  <li key={String(o.id)}>
                    <span className={`dash-feed-dot ${up ? '' : 'back'}`} aria-hidden />
                    <div>
                      <p>
                        <button className="dash-link" onClick={() => setWho(o.workerId)}>{name(o.workerId)}</button>{' '}
                        {up ? 'moved up to' : o.outcome === 'override' ? 'set by coach to' : 'stepped back to'} <strong>{LEVEL_NAME[o.levelAfter]}</strong> on “{lookup.stepText(o.taskId, o.stepId)}”
                      </p>
                      <p className="sv-mono">{lookup.title(o.taskId)} · {o.ts.toDate().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </Panel>

        <Panel id="dash-grid" className="span-7" title="How much help does each step get now?" sub="Support level per worker and step. Tap a cell to see it and change the level; tap a name to filter.">
          <Heatmap mastery={myMastery} name={name} lookup={lookup} onPickWorker={setWho} />
        </Panel>
        <Panel id="dash-reteach" className="span-5" title="Which steps need re-teaching?" sub="Steps with the most corrections, hints and help requests in this range. Tap one for who struggled.">
          {reteach.length === 0 ? (
            <Calm text="No corrections or help requests in this range. Nothing to re-teach." />
          ) : (
            <>
              <Bars
                selected={focus}
                onPick={(k) => setFocus((f) => (f === k ? null : k))}
                rows={reteach.map((m) => ({
                  key: m.key,
                  label: lookup.stepText(m.taskId, m.stepId),
                  badge: needsReteach.includes(m) ? 're-teach' : undefined,
                  parts: [
                    { n: m.error, cls: 'err', label: 'corrections' },
                    { n: m.assisted, cls: 'ast', label: 'hints' },
                    { n: m.help, cls: 'help', label: 'help requests' },
                  ],
                  meta: lookup.title(m.taskId),
                }))}
              />
              <Legend items={[['err', 'Corrections'], ['ast', 'Hints'], ['help', 'Help requests']]} />
              {focusRow && (
                <div className="dash-detail" role="region" aria-label="Step detail">
                  <p><strong>“{lookup.stepText(focusRow.taskId, focusRow.stepId)}”</strong></p>
                  <p className="sv-mono">
                    {lookup.title(focusRow.taskId)} · {focusRow.clean} clean of {focusRow.clean + focusRow.error + focusRow.assisted} finished
                    {focusRow.backs ? ` · ${plural(focusRow.backs, 'step back')}` : ''}
                  </p>
                  <ul className="dash-who">
                    {[...focusRow.workers.entries()].sort((a, b) => b[1] - a[1]).map(([w, n]) => (
                      <li key={w}><button className="dash-link" onClick={() => setWho(w)}>{name(w)}</button> <span className="num">{n}</span></li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </Panel>

        <Panel id="dash-help" className="span-6" title="Is help arriving fast?" sub="'I'm stuck' goes to a buddy first, then the supervisor after 20 s.">
          {curHelp.length === 0 ? (
            <Calm text="No help requests in this range." />
          ) : (
            <div className="dash-help">
              <div>
                <p className="sv-mono">Time until someone claimed it</p>
                <Histogram buckets={helpers.buckets} />
              </div>
              <div>
                <p className="sv-mono">Who came to help</p>
                {helpers.by.length ? (
                  <Bars rows={helpers.by.map(([b, n]) => ({ key: b, label: b, parts: [{ n, cls: 'buddy', label: 'claims' }] }))} />
                ) : (
                  <Calm text="Nobody has claimed a request yet." />
                )}
              </div>
            </div>
          )}
          <div className="dash-stats">
            <Stat n={curHelp.length} label="help requests" help={unanswered > 0} />
            <Stat n={within == null ? '—' : `${within}%`} label="of requests claimed within 20 s" />
            <Stat n={helpers.escalated} label="went on to the supervisor" />
            <Stat n={doubleClaims(attempts)} label="claimed twice (should be 0)" good />
          </div>
        </Panel>

        <Panel id="dash-voice" className="span-6" title="Is the voice coach useful?" sub="Questions workers asked out loud, and how the coach answered in the supervisor's voice.">
          {voice.n === 0 ? (
            <Calm text="No questions asked in this range." />
          ) : (
            <>
              <div className="dash-stats">
                <Stat n={voice.n} label={`questions from ${plural(voice.askers, 'worker')}`} />
                <Stat n={voice.fixed == null ? '—' : `${voice.fixed}%`} label="answered with a set reply (no AI call)" />
                <Stat n={voice.p50 == null ? '—' : voice.p50 < 1000 ? `${Math.round(voice.p50)} ms` : `${(voice.p50 / 1000).toFixed(1)} s`} label="median time to answer" />
                <Stat n={voice.askedHelp} label="turned into a help call" />
              </div>
              <p className="sv-mono dash-lines-h">Recent replies the coach spoke</p>
              <ul className="dash-lines">
                {voice.lines.map((l) => (
                  <li key={l}>“{l}”</li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>
    </section>
  )
}

function Panel({ id, title, sub, className, children }: { id?: string; title: string; sub?: string; className?: string; children: React.ReactNode }) {
  return (
    <article id={id} className={`dash-panel card ${className ?? ''}`}>
      <header>
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </header>
      {children}
    </article>
  )
}

const Calm = ({ text }: { text: string }) => <p className="dash-calm">{text}</p>

function Kpi({ label, value, sub, trend, means, onClick, tag, help }: { label: string; value: string | null; sub?: string; trend: Trend; means: string; onClick?: () => void; tag?: string; help?: boolean }) {
  return (
    <button type="button" className={`dash-kpi card ${help ? 'help' : ''}`} title={means} onClick={onClick} aria-label={`${label}: ${value ?? 'no data'}. ${means}`}>
      <span className="dash-kpi-l sv-mono">{label}{tag && <em className="dash-tag">{tag}</em>}</span>
      <span className="dash-kpi-n num">{value ?? '—'}</span>
      {sub && <span className="dash-kpi-s">{sub}</span>}
      <span className={`dash-kpi-d ${trend.tone}`}>{trend.tone === 'good' ? '▲ ' : trend.tone === 'bad' ? '▼ ' : ''}{value == null && trend.tone !== 'none' ? 'No data yet' : trend.text}</span>
      <span className="dash-kpi-m">{means}</span>
    </button>
  )
}

function Stat({ n, label, good, help }: { n: number | string; label: string; good?: boolean; help?: boolean }) {
  return (
    <div className={`dash-stat ${good ? 'good' : ''} ${help ? 'help' : ''}`}>
      <span className="num">{n}</span>
      <span>{label}</span>
    </div>
  )
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="dash-legend">
      {items.map(([c, l]) => (
        <span key={c}><i className={`sw ${c}`} aria-hidden />{l}</span>
      ))}
    </div>
  )
}

function LineChart({ series, name, onPick }: { series: { w: string; pts: { t: number; v: number; n: number }[] }[]; name: (id: string) => string; onPick: (w: string) => void }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null)
  if (!series.length) return <Calm text="No finished steps in this range yet. The chart fills in as workers do their tasks." />
  const W = 640, H = 240, L = 40, R = 12, T = 14, B = 28
  const maxN = Math.max(...series.map((s) => s.pts.length))
  const x = (i: number) => L + (maxN <= 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (maxN - 1))
  const y = (v: number) => T + ((100 - v) * (H - T - B)) / 100
  return (
    <div className="dash-line">
      <div className="dash-chips" role="group" aria-label="Show workers">
        {series.map((s, i) => {
          const first = s.pts[0]?.v ?? 0
          const last = s.pts[s.pts.length - 1]?.v ?? 0
          const d = last - first
          return (
            <button key={s.w} aria-pressed={!hidden.has(s.w)} className={hidden.has(s.w) ? 'off' : ''} onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(s.w)) n.delete(s.w); else n.add(s.w); return n })} title={`${name(s.w)}: first run ${first}%, latest ${last}%`}>
              <i style={{ background: SERIES[i % SERIES.length] }} aria-hidden />
              {name(s.w)}
              {s.pts.length > 1 && <span className={`num dash-chip-d ${d > 0 ? 'good' : ''}`}>{d > 0 ? '+' : ''}{d} pts</span>}
            </button>
          )
        })}
      </div>
      <div className="dash-svgwrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Share of steps done on their own, per task run" onMouseLeave={() => setHover(null)}>
          {[0, 50, 100].map((g) => (
            <g key={g}>
              <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} className="grid" />
              <text x={L - 6} y={y(g) + 4} textAnchor="end" className="tick">{g}%</text>
            </g>
          ))}
          <text x={L} y={H - 6} className="tick">first run</text>
          <text x={W - R} y={H - 6} textAnchor="end" className="tick">latest run →</text>
          {series.map((s, si) => {
            if (hidden.has(s.w)) return null
            const c = SERIES[si % SERIES.length]
            const d = s.pts.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.v)}`).join(' ')
            const area = `${d} L${x(s.pts.length - 1)},${y(0)} L${x(0)},${y(0)} Z`
            return (
              <g key={s.w}>
                {series.length - hidden.size === 1 && <path d={area} fill={c} opacity={0.12} />}
                <path d={d} fill="none" stroke={c} strokeWidth={2.5} strokeLinejoin="round" />
                {s.pts.map((p, i) => {
                  const text = `${name(s.w)} · run ${i + 1} · ${p.v}% on their own (${plural(p.n, 'step')}) · ${new Date(p.t).toLocaleDateString()}`
                  return (
                    <circle key={i} cx={x(i)} cy={y(p.v)} r={5} fill="var(--card)" stroke={c} strokeWidth={2.5} tabIndex={0} className="pt"
                      aria-label={text}
                      onClick={() => onPick(s.w)}
                      onMouseEnter={() => setHover({ x: x(i), y: y(p.v), text })}
                      onFocus={() => setHover({ x: x(i), y: y(p.v), text })}
                      onBlur={() => setHover(null)}
                    />
                  )
                })}
              </g>
            )
          })}
        </svg>
        {hover && (
          <div className="dash-tip" style={{ left: `${Math.min(80, Math.max(20, (hover.x / W) * 100))}%`, top: `${(hover.y / H) * 100}%` }} role="status">
            {hover.text}
          </div>
        )}
      </div>
    </div>
  )
}

type MasteryRow = { workerId: string; taskId: string; stepId: number; level: number; streak: number; attempts: number; recent: string }

function Heatmap({ mastery, name, lookup, onPickWorker }: { mastery: readonly MasteryRow[]; name: (id: string) => string; lookup: DashLookup; onPickWorker: (w: string) => void }) {
  const count = (id: string) => mastery.filter((m) => m.taskId === id).length
  const tasks = [...new Set(mastery.map((m) => m.taskId))].sort((a, b) => count(b) - count(a))
  const [task, setTask] = useState<string>('')
  const [sel, setSel] = useState<MasteryRow | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const setLevel = useReducer(reducers.setSupportLevel)
  if (!tasks.length) return <Calm text="No support levels yet. They appear after a worker's first steps." />
  const t = tasks.includes(task) ? task : tasks[0]
  const rows = mastery.filter((m) => m.taskId === t)
  const ws = [...new Set(rows.map((m) => m.workerId))]
  const steps = [...new Set(rows.map((m) => m.stepId))].sort((a, b) => a - b)
  const cell = (w: string, s: number) => rows.find((m) => m.workerId === w && m.stepId === s)
  const live = sel && rows.find((m) => m.workerId === sel.workerId && m.stepId === sel.stepId && m.taskId === sel.taskId)
  return (
    <div className="dash-heat">
      {tasks.length > 1 && (
        <label className="dash-select">
          <span className="sv-mono">Task</span>
          <select value={t} onChange={(e) => { setTask(e.target.value); setSel(null) }}>
            {tasks.map((x) => <option key={x} value={x}>{lookup.title(x)}</option>)}
          </select>
        </label>
      )}
      <div className="dash-heat-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">Worker</span></th>
              {steps.map((s) => <th key={s} scope="col" className="num" title={lookup.stepText(t, s)}>S{s}</th>)}
            </tr>
          </thead>
          <tbody>
            {ws.map((w) => (
              <tr key={w}>
                <th scope="row"><button className="dash-link" onClick={() => onPickWorker(w)} title={`Show only ${name(w)}`}>{name(w)}</button></th>
                {steps.map((s) => {
                  const m = cell(w, s)
                  if (!m) return <td key={s}><span className="dash-cell empty" title="Not tried yet" aria-hidden /></td>
                  const on = live && live.workerId === w && live.stepId === s
                  return (
                    <td key={s}>
                      <button
                        className={`dash-cell ${on ? 'sel' : ''}`}
                        style={{ background: LEVEL_FILL[m.level], color: m.level >= 2 ? '#ECE8E1' : '#2A3133' /* fixed tiles: fixed ink, both themes */ }}
                        onClick={() => { setSel(m); setMsg(null) }}
                        aria-label={`${name(w)}, step ${s}: ${LEVEL_NAME[m.level]}`}
                        title={`${name(w)} · ${lookup.stepText(t, s)} · ${LEVEL_NAME[m.level]} · ${m.streak} clean in a row`}
                      >
                        <span className="num">{m.level}</span>
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="dash-legend">
        {LEVEL_NAME.map((l, i) => <span key={l}><i className="sw" style={{ background: LEVEL_FILL[i] }} aria-hidden /><span className="num">{i}</span> {l}</span>)}
      </div>
      {live && (
        <div className="dash-detail" role="region" aria-label="Step detail">
          <p><strong>{name(live.workerId)}</strong> · step {live.stepId}: “{lookup.stepText(live.taskId, live.stepId)}”</p>
          <p className="sv-mono">Clean in a row <span className="num">{live.streak}</span> · tries <span className="num">{live.attempts}</span> · now: {LEVEL_NAME[live.level]}{live.level < 3 ? ` · ${Math.max(0, 3 - live.streak)} more clean to move up` : ''}</p>
          <div className="dash-seg" role="radiogroup" aria-label="Change support level">
            {LEVEL_NAME.map((l, i) => (
              <button key={l} role="radio" aria-checked={live.level === i} className={live.level === i ? 'on' : ''}
                onClick={() => setLevel({ workerId: live.workerId, taskId: live.taskId, stepId: live.stepId, level: i }).then(() => setMsg(`Set to ${l}.`)).catch((e: Error) => setMsg(`Could not change the level: ${e.message}`))}>
                {l}
              </button>
            ))}
          </div>
          {msg && <p className="caption" role="status">{msg}</p>}
        </div>
      )}
    </div>
  )
}

type BarRow = { key: string; label: string; meta?: string; badge?: string; parts: { n: number; cls: string; label: string }[] }
function Bars({ rows, onPick, selected }: { rows: BarRow[]; onPick?: (k: string) => void; selected?: string | null }) {
  const max = Math.max(1, ...rows.map((r) => r.parts.reduce((a, p) => a + p.n, 0)))
  const seen = new Set<string>()
  const dupes = new Set(rows.filter((r) => (seen.has(r.label) ? true : (seen.add(r.label), false))).map((r) => r.label))
  return (
    <ul className="dash-bars">
      {rows.map((r) => {
        const total = r.parts.reduce((a, p) => a + p.n, 0)
        const detail = r.parts.filter((p) => p.n).map((p) => `${p.n} ${p.label}`).join(', ')
        const inner = (
          <>
            <span className="dash-bar-l">{r.label}{r.badge && <em className="dash-tag">{r.badge}</em>}{r.meta && dupes.has(r.label) && <small className="dash-bar-meta">{r.meta} · {r.key.split('#')[0]}</small>}</span>
            <span className="dash-bar-track">
              {r.parts.map((p) => p.n > 0 && <span key={p.cls} className={`dash-bar ${p.cls}`} style={{ width: `${(100 * p.n) / max}%` }} />)}
            </span>
            <span className="num dash-bar-n">{total}</span>
            <span className="dash-bar-tip" aria-hidden>{detail}</span>
          </>
        )
        return (
          <li key={r.key} className={selected === r.key ? 'sel' : ''}>
            {onPick ? (
              <button type="button" className="dash-bar-row" onClick={() => onPick(r.key)} aria-pressed={selected === r.key} title={`${r.label}${r.meta ? ` (${r.meta})` : ''}: ${detail}`} aria-label={`${r.label}: ${detail}`}>{inner}</button>
            ) : (
              <div className="dash-bar-row" tabIndex={0} title={`${r.label}: ${detail}`} aria-label={`${r.label}: ${detail}`}>{inner}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function Histogram({ buckets }: { buckets: { label: string; n: number; late: boolean }[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.n))
  return (
    <div className="dash-hist" role="img" aria-label={buckets.map((b) => `${b.label}: ${b.n}`).join(', ')}>
      {buckets.map((b, i) => (
        <div key={b.label} className={`dash-hist-col ${b.late ? 'late' : ''} ${i === 2 ? 'cut' : ''}`} title={`${b.n} claimed in ${b.label}${b.late ? ' (after the buddy window)' : ''}`}>
          <span className="num">{b.n}</span>
          <span className="dash-hist-bar" style={{ height: `${(100 * b.n) / max}%` }} />
          <span className="sv-mono">{b.label}</span>
        </div>
      ))}
    </div>
  )
}
