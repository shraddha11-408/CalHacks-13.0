/** StatCard({ value?, label, source?, sourceHref? }) — big mono number, label, source chip. Missing value shows "—". */
export function StatCard({ value, label, source, sourceHref }: { value?: string | number | null; label: string; source?: string; sourceHref?: string }) {
  const v = value === undefined || value === null || value === '' ? '—' : value
  return (
    <div className="stat-card card">
      <span className="stat-value num">{v}</span>
      <span className="stat-label">{label}</span>
      {source &&
        (sourceHref ? (
          <a className="stat-source" href={sourceHref} target="_blank" rel="noreferrer">{source}</a>
        ) : (
          <span className="stat-source">{source}</span>
        ))}
    </div>
  )
}
