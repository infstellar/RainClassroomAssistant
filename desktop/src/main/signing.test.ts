import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateJoinDelay } from './signing.ts'

const config = { type: 1, custom: { time: 120, cutoff: 120 } }

test('chooses an inclusive randomized delay inside the active course-start window', () => {
  assert.equal(
    calculateJoinDelay(1_000_000, config, 1_030_000, () => 0),
    10,
  )
  assert.equal(
    calculateJoinDelay(1_000_000, config, 1_030_000, () => 0.999),
    120,
  )
})

test('does not delay after cutoff or when delay strategy is disabled', () => {
  assert.equal(
    calculateJoinDelay(1_000_000, config, 1_120_000, () => 0),
    10,
  )
  assert.equal(
    calculateJoinDelay(1_000_000, config, 1_121_000, () => 0.5),
    0,
  )
  assert.equal(
    calculateJoinDelay(1_000_000, { ...config, type: 2 }, 1_000_000),
    0,
  )
})
