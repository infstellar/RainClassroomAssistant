import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collectProblemDisplayIndexes,
  normalizePresentationSlides,
} from './slides.ts'

test('maps problem identifiers to classroom display indexes', () => {
  const indexes = new Map<string, string | number>()
  collectProblemDisplayIndexes(
    [
      { type: 'problem', prob: 'problem-1', sid: 'slide-1', si: 12 },
      { type: 'other', prob: 'ignored', si: 13 },
    ],
    indexes,
  )
  assert.equal(indexes.get('problem-1'), 12)
  assert.equal(indexes.get('slide-1'), 12)
  assert.equal(indexes.has('ignored'), false)
})

test('normalizes problem page indexes and prefers problem slides on conflicts', () => {
  const indexes = new Map([['problem-1', 8]])
  const slides = normalizePresentationSlides(
    [
      { index: 2, cover: 'cover-1' },
      { index: 3, problem: { problemId: 'problem-1' }, cover: 'cover-2' },
      { index: 8, problem: { problemId: 'problem-1' }, cover: 'cover-3' },
    ],
    indexes,
  )
  assert.deepEqual(
    slides.map((slide) => slide.index),
    [2, 8],
  )
  assert.equal(slides[1].cover, 'cover-2')
})
