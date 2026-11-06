import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeAnswerCache } from './cache-store.ts'

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
