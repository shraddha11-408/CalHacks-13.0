import { useState } from 'react'
import { Panel, TierBadge } from '../components/ui'
import { fmtLatency, fmtUsd, pct } from '../format'
import { EVAL, METRICS } from '../mock'

const TIER_FILL = { checker: 'var(--chart-checker)', bitdeer: 'var(--chart-bitdeer)', claude: 'var(--chart-claude)' } as const
const TIER_NAME = { checker: 'Checker', bitdeer: 'Bitdeer', claude: 'Claude' } as const

/** Share of checks decided by each tier: one stacked bar, legend + direct labels, hover tooltip. */
function TierMixChart() {
  const [hover, setHover] = useState<{ key: keyof typeof TIER_FILL; x: number } | null>(null)
  const W = 600
  const H = 56
  const gap = 2
  const entries = (Object.keys(TIER_FILL) as (keyof typeof TIER_FILL)[]).map((k) => ({ k, v: METRICS.tier_mix[k] }))
  let x = 0
  const segs = entries.map((e) => {
    const w = e.v * W
    const s = { ...e, x, w }
    x += w
    return s
  })
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="legend" aria-hidden>
        {entries.map((e) => (
          <span key={e.k}>
            <i style={{ background: TIER_FILL[e.k] }} />
            {TIER_NAME[e.k]}
          </span>
        ))}
      </div>
      <div style={{ position: 'relative' }}>
        <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Tier mix: ${entries.map((e) => `${TIER_NAME[e.k]} ${pct(e.v)}`).join(', ')}`}>
          {segs.map((s, i) => (
            <g key={s.k} onMouseEnter={() => setHover({ key: s.k, x: s.x + s.w / 2 })} onMouseLeave={() => setHover(null)}>
              <rect
                x={s.x + (i ? gap / 2 : 0)}
                y={0}
                width={Math.max(s.w - gap, 1)}
                height={32}
                rx={4}
                style={{ fill: TIER_FILL[s.k], opacity: hover && hover.key !== s.k ? 0.55 : 1 }}
              />
              {s.w > 60 && (
                <text x={s.x + 8} y={50} className="val">
                  {TIER_NAME[s.k]} {pct(s.v)}
                </text>
              )}
              <rect x={s.x} y={-4} width={s.w} height={H + 4} fill="transparent" />
            </g>
          ))}
        </svg>
        {hover && (
          <div className="chart-tip" style={{ left: `${(hover.x / W) * 100}%`, top: 0 }}>
            {TIER_NAME[hover.key]}: {pct(METRICS.tier_mix[hover.key])} of checks
          </div>
        )}
      </div>
    </div>
  )
}

/** Prompts per session over days 1–5 (simulated). Single series: title names it, no legend. */
function FadingChart() {
  const data = EVAL.fading
  const [hover, setHover] = useState<number | null>(null)
  const W = 600
  const H = 240
  const m = { l: 36, r: 16, t: 16, b: 32 }
  const max = Math.ceil(Math.max(...data) / 4) * 4
  const xs = (i: number) => m.l + (i * (W - m.l - m.r)) / (data.length - 1)
  const ys = (v: number) => m.t + (1 - v / max) * (H - m.t - m.b)
  const ticks = [0, max / 2, max]
  const path = data.map((v, i) => `${i ? 'L' : 'M'}${xs(i)},${ys(v)}`).join(' ')
  return (
    <div style={{ position: 'relative' }}>
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Prompts per session, simulated: ${data.map((v, i) => `day ${i + 1} ${v}`).join(', ')}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const px = ((e.clientX - r.left) / r.width) * W
          const i = Math.round(((px - m.l) / (W - m.l - m.r)) * (data.length - 1))
          setHover(Math.min(Math.max(i, 0), data.length - 1))
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={ys(t)} y2={ys(t)} style={{ stroke: 'var(--chart-grid)', strokeWidth: 1 }} />
            <text x={m.l - 8} y={ys(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {data.map((_, i) => (
          <text key={i} x={xs(i)} y={H - 8} textAnchor="middle">
            Day {i + 1}
          </text>
        ))}
        {hover !== null && <line x1={xs(hover)} x2={xs(hover)} y1={m.t} y2={H - m.b} style={{ stroke: 'var(--ink-2)', strokeWidth: 1, strokeDasharray: '3 3' }} />}
        <path d={path} style={{ fill: 'none', stroke: 'var(--primary)', strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' }} />
        {data.map((v, i) => (
          <circle key={i} cx={xs(i)} cy={ys(v)} r={hover === i ? 6 : 4.5} style={{ fill: 'var(--primary)', stroke: 'var(--surface)', strokeWidth: 2 }} />
        ))}
        <text x={xs(0) + 10} y={ys(data[0]) - 8} className="val">
          {data[0]}
        </text>
        <text x={xs(data.length - 1) - 10} y={ys(data[data.length - 1]) - 10} className="val" textAnchor="end">
          {data[data.length - 1]}
        </text>
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${(xs(hover) / W) * 100}%`, top: `${(ys(data[hover]) / H) * 100}%` }}>
          Day {hover + 1}: {data[hover]} prompts
        </div>
      )}
    </div>
  )
}

export function ResultsPage() {
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head">
        <h1>Results</h1>
        <p className="muted">Placeholders until the eval harness (eval/) runs on the labeled clips. Only measured numbers get quoted.</p>
      </div>

      <div className="two-col">
        <Panel title="Which tier decided" simulated>
          <TierMixChart />
        </Panel>
        <Panel title="Prompts per session" simulated>
          <FadingChart />
          <p className="small muted" style={{ marginTop: 8 }}>
            Fading curve is simulated from scripted sessions.
          </p>
        </Panel>
      </div>

      <Panel title="Per-tier accuracy, latency, cost" simulated>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tier</th>
                <th className="n">Precision</th>
                <th className="n">Recall</th>
                <th className="n">False corrections</th>
                <th className="n">p50</th>
                <th className="n">p99</th>
                <th className="n">Cost / check</th>
              </tr>
            </thead>
            <tbody>
              {EVAL.tiers.map((t) => (
                <tr key={t.tier}>
                  <td>
                    <TierBadge tier={t.tier} />
                  </td>
                  <td className="n num">{pct(t.precision)}</td>
                  <td className="n num">{pct(t.recall)}</td>
                  <td className="n num">{pct(t.false_corr, 1)}</td>
                  <td className="n num">{fmtLatency(t.p50)}</td>
                  <td className="n num">{fmtLatency(t.p99)}</td>
                  <td className="n num">{fmtUsd(t.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="two-col">
        <Panel title="Bitdeer model comparison" simulated>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="n">Precision</th>
                  <th className="n">p50</th>
                  <th className="n">Cost / check</th>
                </tr>
              </thead>
              <tbody>
                {EVAL.bitdeer_models.map((r) => (
                  <tr key={r.model}>
                    <td>{r.model}</td>
                    <td className="n num">{pct(r.precision)}</td>
                    <td className="n num">{fmtLatency(r.p50)}</td>
                    <td className="n num">{fmtUsd(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Moss question path" simulated>
          <div className="table-wrap">
            <table>
              <tbody>
                <tr><td>Retrieval p50 / p99</td><td className="n num">{fmtLatency(EVAL.moss.p50)} / {fmtLatency(EVAL.moss.p99)}</td></tr>
                <tr><td>Answered with no model call</td><td className="n num">{pct(EVAL.moss.no_model_share)}</td></tr>
                <tr><td>False-answer rate</td><td className="n num">{pct(EVAL.moss.false_answer)}</td></tr>
                <tr><td>Scripted questions</td><td className="n num">{EVAL.moss.questions}</td></tr>
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  )
}
