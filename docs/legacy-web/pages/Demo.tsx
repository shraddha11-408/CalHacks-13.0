import { Brand } from '../components/Layout'
import { EventStream } from '../components/streams'
import { MetricTile, Panel } from '../components/ui'
import { fmtLatency, pct } from '../format'
import { useTheme } from '../theme'
import { EVENTS, METRICS } from '../mock'
import { WorkerStage } from './Worker'

/** Clean full-screen judge view: worker stage + live proof on the side. */
export function DemoPage() {
  useTheme() // keep the chosen theme on this chrome-less route
  return (
    <div className="demo">
      <div className="stack" style={{ gap: 20 }}>
        <Brand />
        <WorkerStage name="Jordan" level={0} compact />
      </div>
      <aside className="demo-side" aria-label="Live proof">
        <div className="metrics" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <MetricTile label="Check p50" value={fmtLatency(METRICS.p50_ms)} sub="simulated" />
          <MetricTile label="Moss answer" value={fmtLatency(METRICS.moss_p50_ms)} sub="simulated" />
          <MetricTile label="No model call" value={pct(METRICS.moss_no_model_share)} sub="simulated" />
          <MetricTile label="False corrections" value={pct(METRICS.false_correction_rate, 1)} sub="simulated" />
        </div>
        <Panel title="Live floor" simulated>
          <EventStream events={EVENTS} />
        </Panel>
      </aside>
    </div>
  )
}
