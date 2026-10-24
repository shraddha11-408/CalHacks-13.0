// Speech arbitration: who may interrupt whom (node --test, with a stub <audio>).
import assert from 'node:assert/strict'
import { test } from 'node:test'

class FakeAudio {
  src = ''
  preload = ''
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  play() {
    return Promise.resolve()
  }
  pause() {}
}
;(globalThis as unknown as { Audio: typeof FakeAudio }).Audio = FakeAudio
const { AudioQueue } = await import('./audio.ts')

const s = (text: string) => ({ text, url: `/tts?text=${text}` })
const setup = () => {
  const q = new AudioQueue()
  const heard: string[] = []
  q.onCaption = (t) => t && heard.push(t)
  const el = (q as unknown as { el: FakeAudio }).el
  return { q, heard, finish: () => el.onended?.() }
}

test('a stuck hint never cuts off a correction', () => {
  const { q, heard } = setup()
  q.say([s('Almost. Turn the sleeve.')], 'correction')
  q.say([s('Take your time.')], 'stuck')
  assert.deepEqual(heard, ['Almost. Turn the sleeve.'])
})

test('a new step interrupts a correction, and a late correction is dropped', () => {
  const { q, heard } = setup()
  q.say([s('Almost. Turn the sleeve.')], 'correction')
  q.say([s('Great job!'), s('Next step.')], 'advance')
  q.say([s('Almost. Turn it more.')], 'correction')
  assert.deepEqual(heard, ['Almost. Turn the sleeve.', 'Great job!'])
})

test('two corrections do not stack', () => {
  const { q, heard } = setup()
  q.say([s('Almost. A.')], 'correction')
  q.say([s('Almost. B.')], 'correction')
  assert.deepEqual(heard, ['Almost. A.'])
})

test('an answer waits for the new step to finish, then plays', () => {
  const { q, heard, finish } = setup()
  q.say([s('Great job!')], 'advance')
  q.say([s('The sleeve keeps hands cool.')], 'answer')
  assert.deepEqual(heard, ['Great job!'])
  finish()
  assert.deepEqual(heard, ['Great job!', 'The sleeve keeps hands cool.'])
})

test('the same sentence is not repeated within a few seconds, unless forced', () => {
  const { q, heard, finish } = setup()
  q.say([s('Take your time.')], 'stuck')
  finish()
  q.say([s('Take your time.')], 'stuck')
  assert.equal(heard.length, 1)
  q.say([s('Take your time.')], 'answer', { force: true })
  assert.equal(heard.length, 2)
})
