import assert from 'node:assert/strict'
import test from 'node:test'
import { DanmuFollower } from './danmu.ts'

test('sends when identical danmu reaches the configured rolling-window threshold', () => {
  const follower = new DanmuFollower()
  assert.equal(follower.shouldSend('好耶', 3, 0), false)
  assert.equal(follower.shouldSend('好耶', 3, 10_000), false)
  assert.equal(follower.shouldSend('好耶', 3, 20_000), true)
  assert.equal(follower.shouldSend('好耶', 3, 30_000), false)
  assert.equal(follower.shouldSend('好耶', 3, 80_001), false)
})

test('expires old votes and treats capitalization and whitespace as the same message', () => {
  const follower = new DanmuFollower()
  assert.equal(follower.shouldSend('  Yes  ', 2, 0), false)
  assert.equal(follower.shouldSend('yes', 2, 60_001), false)
  assert.equal(follower.shouldSend('YES', 2, 61_000), true)
})

test('ignores blank content and throttles repeated sends per minute', () => {
  const follower = new DanmuFollower()
  assert.equal(follower.shouldSend(' ', 1, 0), false)
  assert.equal(follower.shouldSend('ok', 1, 0), true)
  assert.equal(follower.shouldSend('ok', 1, 60_000), false)
  assert.equal(follower.shouldSend('ok', 1, 60_001), true)
})
