import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveCachedAnswer } from './answer-cache.ts'

test('manual answers override AI cache answers', () => {
  const cache = {
    metadata: {},
    answers: { '3': ['A'] },
    manual_answers: { '3': ['B'] },
  }
  assert.deepEqual(resolveCachedAnswer(cache, '3'), ['B'])
})

test('ignores empty templates and insufficient-context markers', () => {
  const cache = {
    metadata: {},
    answers: { '3': ['__INSUFFICIENT_CONTEXT__'] },
    manual_answers: { '3': [] },
  }
  assert.equal(resolveCachedAnswer(cache, '3'), undefined)
  assert.equal(
    resolveCachedAnswer(
      {
        metadata: {},
        manual_answers: {
          '2': { suggested_answers: ['请在此处填写建议答案'] },
        },
      },
      '2',
    ),
    undefined,
  )
})

test('reads legacy answer dictionaries', () => {
  assert.deepEqual(resolveCachedAnswer({ '5': ['C'] }, '5'), ['C'])
})

test('rejects answers cached for a different problem on the same slide', () => {
  const cache = {
    metadata: { problem_signature: [{ index: '3', id: 'old' }] },
    answers: { '3': ['A'] },
  }
  assert.equal(
    resolveCachedAnswer(cache, '3', [
      { index: 3, problem: { problemId: 'new' } },
    ]),
    undefined,
  )
  assert.deepEqual(
    resolveCachedAnswer(cache, '3', [
      { index: 3, problem: { problemId: 'old' } },
    ]),
    ['A'],
  )
})
