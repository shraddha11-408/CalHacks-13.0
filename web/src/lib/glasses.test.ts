// JPEG splitting for the glasses stream (node --test).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JpegSplitter, PcmDecoder } from './glasses.ts'

const jpeg = (...body: number[]) => [0xff, 0xd8, ...body, 0xff, 0xd9]
const part = (bytes: number[]) => [...new TextEncoder().encode('--frame\r\nContent-Type: image/jpeg\r\n\r\n'), ...bytes, 0x0d, 0x0a]
const u8 = (a: number[]) => new Uint8Array(a)

test('two frames in one chunk come out whole, multipart headers dropped', () => {
  const s = new JpegSplitter()
  const out = s.push(u8([...part(jpeg(1, 2)), ...part(jpeg(3))]))
  assert.deepEqual(out.map((f) => [...f]), [jpeg(1, 2), jpeg(3)])
})

test('a frame split across chunks, even inside a marker, waits for its end', () => {
  const s = new JpegSplitter()
  const bytes = part(jpeg(7, 8, 9))
  const cut = bytes.indexOf(0xd9) // between 0xff and 0xd9 of the end marker
  assert.deepEqual(s.push(u8(bytes.slice(0, cut))), [])
  assert.deepEqual(s.push(u8(bytes.slice(cut))).map((f) => [...f]), [jpeg(7, 8, 9)])
})

test('a start marker split across chunks is kept', () => {
  const s = new JpegSplitter()
  const bytes = jpeg(5)
  assert.deepEqual(s.push(u8([0x0d, 0x0a, bytes[0]])), [])
  assert.deepEqual(s.push(u8(bytes.slice(1))).map((f) => [...f]), [jpeg(5)])
})

test('PCM: little-endian int16 to floats, an odd byte carried to the next chunk', () => {
  const d = new PcmDecoder()
  // samples 0x4000 (0.5), 0xC000 (-0.5), 0x7FFF; the last one split across chunks
  assert.deepEqual([...d.push(u8([0x00, 0x40, 0x00, 0xc0, 0xff]))], [0.5, -0.5])
  const [x] = d.push(u8([0x7f]))
  assert.ok(Math.abs(x - 32767 / 32768) < 1e-9)
  assert.equal(d.push(u8([])).length, 0)
})
