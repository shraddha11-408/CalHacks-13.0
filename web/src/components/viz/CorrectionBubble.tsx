/** CorrectionBubble({ name, text, speaking? }) — coach avatar + "{name}'s voice" + quote. speaking shows 3-bar equalizer. */
export function CorrectionBubble({ name, text, speaking = false }: { name: string; text: string; speaking?: boolean }) {
  return (
    <figure className="cbubble" data-speaking={speaking || undefined}>
      <figcaption className="cb-who">
        <span className="cb-avatar" aria-hidden>{(name.trim()[0] ?? '?').toUpperCase()}</span>
        <span>{name}'s voice</span>
        {speaking && (
          <span className="cb-eq" aria-label="speaking">
            <span /><span /><span />
          </span>
        )}
      </figcaption>
      <blockquote className="cb-text">{text}</blockquote>
    </figure>
  )
}
