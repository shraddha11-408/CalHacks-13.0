import { useEffect, useState } from 'react'
import { HealthDots, Panel } from '../components/ui'
import { useEdgeHealth } from '../edge'
import { fmtLatency } from '../format'
import type { HealthState } from '../types'

interface KillTestRow {
  test: string
  status: 'pass' | 'partial' | 'fail' | 'not_run'
  detail?: string
  timings_ms?: Record<string, number>
  ran_at?: string
}

const NAME: Record<string, string> = {
  camera: 'Camera (webcam)',
  aruco: 'ArUco rectify',
  bitdeer: 'Bitdeer vision',
  cartesia: 'Cartesia voice',
  spacetime: 'SpacetimeDB',
  droid: 'Factory Droid',
  moss: 'Moss retrieval',
}

const BADGE: Record<KillTestRow['status'], { cls: string; label: string; dot: HealthState }> = {
  pass: { cls: 'badge-claimed', label: 'Pass', dot: 'ok' },
  partial: { cls: 'verdict verdict-almost', label: 'Partial', dot: 'degraded' },
  fail: { cls: 'badge-urgent', label: 'Fail', dot: 'down' },
  not_run: { cls: 'badge-soft', label: 'Not run', dot: 'off' },
}

const pretty = (k: string) => k.replace(/_/g, ' ')

export function HealthPage() {
  const edge = useEdgeHealth()
  const [rows, setRows] = useState<KillTestRow[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await fetch('/api/killtests')
        const j = await r.json()
        if (alive) {
          setRows(j.rows)
          setError(false)
        }
      } catch {
        if (alive) setError(true)
      }
    }
    load()
    const id = setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  const passed = rows?.filter((r) => r.status === 'pass').length ?? 0
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head spread">
        <div>
          <h1>Health</h1>
          <p className="muted">Foundation kill-tests. Measured on this laptop, not simulated.</p>
        </div>
        {rows && <HealthDots items={rows.map((r) => ({ name: NAME[r.test] ?? r.test, state: BADGE[r.status].dot }))} />}
      </div>

      <Panel title={rows ? `Kill-tests · ${passed} of ${rows.length} pass` : 'Kill-tests'} actions={<span className="small muted mono">scripts/killtests/run_all.sh</span>}>
        {error || edge.state === 'down' ? (
          <p className="muted">Edge app is not reachable. Start it with ./run.sh.</p>
        ) : !rows ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="table-wrap">
            <table className="killtests">
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Status</th>
                  <th>Timings</th>
                  <th>Detail</th>
                  <th>Ran</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.test}>
                    <td>
                      <strong>{NAME[r.test] ?? r.test}</strong>
                    </td>
                    <td>
                      <span className={BADGE[r.status].cls}>{BADGE[r.status].label}</span>
                    </td>
                    <td className="num small">
                      {r.timings_ms &&
                        Object.entries(r.timings_ms).map(([k, v]) => (
                          <div key={k}>
                            <span className="muted">{pretty(k)}</span> {fmtLatency(v)}
                          </div>
                        ))}
                    </td>
                    <td className="small detail-cell">{r.detail ?? '—'}</td>
                    <td className="small muted num">{r.ran_at?.slice(11) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
