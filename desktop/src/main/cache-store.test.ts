import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeAnswerCache, writeManualAnswerCache } from './cache-store.ts'

test('merges concurrent live and batch writes and preserves manual answers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rainclass-cache-'))
  const path = join(root, 'answers.json')
  try {
    await writeFile(
      path,
      JSON.stringify({
        metadata: {},
        answers: { '1': ['A'] },
        manual_answers: { '2': ['B'] },
      }),
    )
    await Promise.all([
      writeAnswerCache(path, { analysis_status: 'partial' }, { '3': ['C'] }, [
        '2',
      ]),
      writeAnswerCache(path, { analysis_status: 'partial' }, { '4': ['D'] }, [
        '5',
      ]),
    ])
    const cache = JSON.parse(await readFile(path, 'utf8'))
    assert.deepEqual(cache.answers, { '1': ['A'], '3': ['C'], '4': ['D'] })
    assert.deepEqual(cache.manual_answers, { '2': ['B'], '5': [] })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('backs up incompatible caches before analyzing a changed presentation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rainclass-cache-signature-'))
  const path = join(root, 'answers.json')
  try {
    await writeAnswerCache(
      path,
      {},
      { '1': ['A'] },
      [],
      [{ index: 1, problem: { id: 'old' } }],
    )
    await writeAnswerCache(
      path,
      {},
      { '1': ['B'] },
      [],
      [{ index: 1, problem: { id: 'new' } }],
    )
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).answers, {
      '1': ['B'],
    })
    const backup = (await readdir(root)).find((name) =>
      name.includes('.previous-'),
    )
    assert.ok(backup)
    assert.deepEqual(
      JSON.parse(await readFile(join(root, backup), 'utf8')).answers,
      { '1': ['A'] },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writes and clears a manual answer without changing AI answers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rainclass-manual-answer-'))
  const path = join(root, 'answers.json')
  try {
    await writeFile(
      path,
      JSON.stringify({
        metadata: {},
        answers: { '13': ['C'] },
        manual_answers: {},
      }),
    )
    await writeManualAnswerCache(path, '13', 'D')
    let cache = JSON.parse(await readFile(path, 'utf8'))
    assert.deepEqual(cache.answers, { '13': ['C'] })
    assert.deepEqual(cache.manual_answers, { '13': ['D'] })
    assert.ok(Number.isFinite(Date.parse(cache.manual_answer_times['13'])))
    await writeManualAnswerCache(path, '13', null)
    cache = JSON.parse(await readFile(path, 'utf8'))
    assert.deepEqual(cache.answers, { '13': ['C'] })
    assert.deepEqual(cache.manual_answers, {})
    assert.deepEqual(cache.manual_answer_times, {})
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('live answers and older batch snapshots preserve all answers across page changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rainclass-cache-renumber-'))
  const path = join(root, 'answers.json')
  const oldSlides = [
    { index: 16, problem: { id: 'p1' } },
    { index: 20, problem: { id: 'p2' } },
    { index: 25, problem: { id: 'p3' } },
  ]
  const liveSlides = [
    { index: 15, problem: { id: 'p1' } },
    { index: 19, problem: { id: 'p2' } },
    { index: 24, problem: { id: 'p3' } },
  ]
  try {
    await writeAnswerCache(
      path,
      {},
      { '16': ['A'], '20': ['B'] },
      [],
      oldSlides,
    )
    await writeManualAnswerCache(path, '20', 'D')
    await writeAnswerCache(path, {}, { '24': ['C'] }, [], liveSlides)
    let cache = JSON.parse(await readFile(path, 'utf8'))
    assert.deepEqual(cache.answers, { '15': ['A'], '19': ['B'], '24': ['C'] })
    assert.deepEqual(cache.manual_answers, { '19': ['D'] })
    // An in-flight batch still uses the original presentation page numbers.
    await writeAnswerCache(path, {}, { '16': ['A'] }, [], oldSlides)
    cache = JSON.parse(await readFile(path, 'utf8'))
    assert.deepEqual(cache.answers, { '16': ['A'], '20': ['B'], '25': ['C'] })
    assert.deepEqual(cache.manual_answers, { '20': ['D'] })
    await writeManualAnswerCache(path, '19', 'E', liveSlides)
    cache = JSON.parse(await readFile(path, 'utf8'))
    assert.deepEqual(cache.answers, { '15': ['A'], '19': ['B'], '24': ['C'] })
    assert.deepEqual(cache.manual_answers, { '19': ['E'] })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
