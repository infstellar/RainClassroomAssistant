import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateAnswerDelay,
  hasUsableAnswer,
  remainingAnswerTime,
  shouldRetrySubmission,
  submissionCandidates,
} from './answers.ts'

test('normalizes one-based choice indexes to service option letters', () => {
  assert.deepEqual(submissionCandidates(1, [1, '3']), [['A', 'C']])
  assert.deepEqual(submissionCandidates(1, ['C']), [['C']])
  assert.deepEqual(submissionCandidates(2, ['a', 3]), [['A', 'C']])
  assert.throws(() => submissionCandidates(2, [0]), /1到26之间/)
})

test('builds fill-in and alternate multi-blank payloads', () => {
  assert.deepEqual(submissionCandidates(5, ['one', 'two']), [
    { content: 'one\ntwo', pics: [{ pic: '', thumb: '' }] },
  ])
  assert.deepEqual(submissionCandidates(4, ['a', 'b']), [
    ['a', 'b'],
    { '0': 'a', '1': 'b' },
  ])
})

test('retries only the known multi-blank serialization failures', () => {
  assert.equal(
    shouldRetrySubmission(4, '', 'Cannot be cast to JSONArray'),
    true,
  )
  assert.equal(
    shouldRetrySubmission(1, '', 'Cannot be cast to JSONArray'),
    false,
  )
  assert.equal(shouldRetrySubmission(4, '', 'permission denied'), false)
  assert.equal(
    shouldRetrySubmission(
      4,
      '{"code":500,"msg":"JsonArray cannot be cast to String"}',
      'JsonArray cannot be cast to String',
    ),
    true,
  )
})

test('keeps answer delay within the active answer window', () => {
  assert.equal(
    calculateAnswerDelay(30, 4, 50, () => 0.5),
    12,
  )
  assert.equal(
    calculateAnswerDelay(30, 1, 50, () => 0.5),
    14,
  )
  assert.equal(calculateAnswerDelay(30, 3, 50, () => 0.5) <= 30, true)
})

test('treats empty answer containers as missing and uses the server clock for deadlines', () => {
  assert.equal(hasUsableAnswer([]), false)
  assert.equal(hasUsableAnswer(['', null]), false)
  assert.equal(hasUsableAnswer(['A']), true)
  const event = { limit: 30, now: 10500, dt: 10000 }
  assert.equal(remainingAnswerTime(event, 20000, 22000), 27)
  assert.equal(remainingAnswerTime({ limit: -1 }), -1)
})
