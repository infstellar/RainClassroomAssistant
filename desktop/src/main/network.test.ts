import assert from 'node:assert/strict'
import test from 'node:test'
import { isNetworkFailure } from './network.ts'

test('classifies fetch, timeout, and socket failures as network errors', () => {
  assert.equal(isNetworkFailure(new TypeError('fetch failed')), true)
  const timeout = new Error('request timed out')
  timeout.name = 'TimeoutError'
  assert.equal(isNetworkFailure(timeout), true)
  assert.equal(
    isNetworkFailure(
      Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
    ),
    true,
  )
})

test('does not classify application and HTTP failures as network errors', () => {
  assert.equal(isNetworkFailure(new Error('课堂服务返回 HTTP 503')), false)
  assert.equal(isNetworkFailure('unknown failure'), false)
})
