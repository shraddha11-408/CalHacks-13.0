// Sequential speech playback. Every clip's text goes to the caption bar, so what
// the voice says is always on screen too.
export interface Say {
  text: string
  url: string | null
}

export const apiUrl = (u: string) => (u.startsWith('/api') ? u : `/api${u}`)

/**
 * What a message is for. Decides who may interrupt whom, so instructions never pile up while the
 * worker's actions change: a new step beats everything, an answer to the worker beats a correction,
 * a correction beats a reminder, and a "stuck" hint only plays into silence.
 */
export type SpeechKind = 'advance' | 'answer' | 'correction' | 'instruction' | 'stuck' | 'filler'
const PRIORITY: Record<SpeechKind, number> = { advance: 5, answer: 4, correction: 3, instruction: 2, stuck: 1, filler: 0 }
const REPEAT_MS = 6000

export class AudioQueue {
  private el = new Audio()
  private queue: Say[] = []
  private playing = false
  private kind: SpeechKind | null = null
  private said = new Map<string, number>() // text → when it last started (no repeats within REPEAT_MS)
  onCaption: (text: string, speaking: boolean) => void = () => {}

  constructor() {
    this.el.preload = 'auto'
  }

  /**
   * Say these phrases if they matter more than what's playing (see SpeechKind). Lower or equal
   * priority waits its turn only for answers; everything else is dropped rather than queued,
   * because a late correction or hint is about a moment that has already passed.
   */
  say(items: Say[], kind: SpeechKind, opts: { force?: boolean } = {}) {
    const now = Date.now()
    const fresh = opts.force ? items.filter((i) => i.text) : items.filter((i) => i.text && now - (this.said.get(i.text) ?? 0) > REPEAT_MS)
    if (!fresh.length) return
    if (this.playing && this.kind) {
      const cur = PRIORITY[this.kind]
      const mine = PRIORITY[kind]
      if (mine < cur || (mine === cur && kind !== 'advance')) {
        if (kind === 'answer') this.enqueue(fresh) // the worker asked: answer right after
        return
      }
    }
    this.kind = kind
    this.play(fresh)
  }

  /** Replace whatever is playing with these phrases. */
  play(items: Say[]) {
    this.queue = items.filter((i) => i.text)
    this.el.pause()
    this.playing = false
    this.next()
  }

  enqueue(items: Say[]) {
    this.queue.push(...items.filter((i) => i.text))
    if (!this.playing) this.next()
  }

  stop() {
    this.queue = []
    this.el.pause()
    this.playing = false
    this.kind = null
    this.onCaption('', false)
  }

  get busy() {
    return this.playing
  }

  private next() {
    const item = this.queue.shift()
    if (!item) {
      this.playing = false
      this.kind = null
      this.onCaption('', false)
      return
    }
    this.said.set(item.text, Date.now())
    this.playing = true
    this.onCaption(item.text, true)
    if (!item.url) {
      // no audio available: keep the caption up for reading time, then move on
      window.setTimeout(() => this.next(), Math.min(6000, 1200 + item.text.length * 55))
      return
    }
    this.el.src = apiUrl(item.url)
    this.el.onended = () => this.next()
    this.el.onerror = () => window.setTimeout(() => this.next(), 1500)
    this.el.play().catch(() => window.setTimeout(() => this.next(), 1500))
  }
}
