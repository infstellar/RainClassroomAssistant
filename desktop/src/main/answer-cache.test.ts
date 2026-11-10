import assert from 'node:assert/strict'
import test from 'node:test'
import { alignAnswerCache, resolveCachedAnswer } from './answer-cache.ts'

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

test('moves answers by problem ID across renumbering, additions and replacements', () => {
  const cache = {
    metadata: {
      problem_signature: [
        { index: '16', id: 'p1' },
        { index: '20', id: 'p2' },
        { index: '22', id: 'replaced' },
      ],
    },
    answers: { '16': ['A'], '20': ['B'], '22': ['C'] },
    manual_answers: { '20': ['D'] },
    manual_answer_times: { '20': '2026-11-10T07:00:00Z' },
  }
  const slides = [
    { index: 15, problem: { id: 'p1' } },
    { index: 19, problem: { id: 'p2' } },
    { index: 22, problem: { id: 'replacement' } },
    { index: 25, problem: { id: 'added' } },
  ]
  assert.deepEqual(resolveCachedAnswer(cache, '15', slides), ['A'])
  assert.deepEqual(resolveCachedAnswer(cache, '19', slides), ['D'])
  assert.equal(resolveCachedAnswer(cache, '22', slides), undefined)
  assert.equal(resolveCachedAnswer(cache, '25', slides), undefined)
  const aligned = alignAnswerCache(cache, slides)
  assert.deepEqual(aligned.answers, { '15': ['A'], '19': ['B'] })
  assert.deepEqual(aligned.manual_answer_times, {
    '19': '2026-11-10T07:00:00Z',
  })
  assert.deepEqual(cache.answers, { '16': ['A'], '20': ['B'], '22': ['C'] })
})
