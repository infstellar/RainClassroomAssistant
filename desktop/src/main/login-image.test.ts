import assert from 'node:assert/strict'
import test from 'node:test'
import { loginImageMime } from './login-image.ts'

test('recognizes supported QR image formats by their bytes', () => {
  const images = [
    [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png'],
    [Buffer.from([255, 216, 255]), 'image/jpeg'],
    [Buffer.from('GIF89a'), 'image/gif'],
    [Buffer.from('RIFF0000WEBP'), 'image/webp'],
  ] as const

  for (const [bytes, mime] of images) assert.equal(loginImageMime(bytes), mime)
})

test('rejects HTML and unknown content instead of embedding it as an image', () => {
  assert.equal(loginImageMime(Buffer.from('<html>login</html>')), null)
})
