// Sequential speech playback. Every clip's text goes to the caption bar, so what
// the voice says is always on screen too.
export interface Say {
  text: string
  url: string | null
}

export const apiUrl = (u: string) => (u.startsWith('/api') ? u : `/api${u}`)

export class AudioQueue {
  private el = new Audio()
  private queue: Say[] = []
  private playing = false
  onCaption: (text: string, speaking: boolean) => void = () => {}

  constructor() {
    this.el.preload = 'auto'
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
    this.onCaption('', false)
  }

  get busy() {
    return this.playing
  }

  private next() {
    const item = this.queue.shift()
    if (!item) {
      this.playing = false
      this.onCaption('', false)
      return
    }
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
