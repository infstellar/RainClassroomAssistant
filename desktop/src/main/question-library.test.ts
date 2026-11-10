import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { QuestionLibrary } from './question-library.ts'
import { problemSignature } from './answer-cache.ts'
import { downloadPresentation } from './presentation.ts'

test('lists manifest questions, manual priority, AI results, missing images and rejects unknown IDs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rain-library-'))
  try {
    const library = new QuestionLibrary(root)
    assert.deepEqual(await library.listDecks(), [])
    const dir = join(root, 'downloads', 'rainclasscache', 'course', 'deck')
    await mkdir(dir, { recursive: true })
    const slides = [
      { index: 2, problem: { id: 'p2', content: '题目二' } },
      { index: 10, problem: { id: 'p10' } },
      { index: 11 },
    ]
    await writeFile(
      join(dir, 'presentation.json'),
      JSON.stringify({ lessonName: 'course', title: 'deck', slides }),
    )
    await writeFile(join(dir, '2.jpg'), Buffer.from('89504e47', 'hex'))
    const [deck] = await library.listDecks()
    assert.equal(deck.title, 'deck')
    assert.deepEqual(
      (await library.listQuestions(deck.id)).map((q) => [q.index, q.status]),
      [
        ['2', 'unanswered'],
        ['10', 'unanswered'],
      ],
    )
    assert.match(
      (await library.image(deck.id, '2'))!,
      /^data:image\/png;base64,/,
    )
    assert.equal(await library.image(deck.id, '10'), null)
    await assert.rejects(library.image(deck.id, '../config'), /题目不存在/)
    await assert.rejects(library.listQuestions('../config'), /课件不存在/)
    await mkdir(join(root, 'ai_answers_cache'))
    const cachePath = join(root, 'ai_answers_cache', 'course_deck.json')
    await writeFile(
      cachePath,
      JSON.stringify({
        metadata: {
          lesson_name: 'course',
          presentation_title: 'deck',
          problem_signature: problemSignature(slides),
        },
        answers: { '2': [1] },
        manual_answers: { '2': [3], '10': [] },
      }),
    )
    assert.equal((await library.listDecks()).length, 1)
    const questions = await library.listQuestions(deck.id)
    assert.deepEqual(questions[0], {
      index: '2',
      text: '题目二',
      aiAnswer: [1],
      answer: [3],
      source: 'manual',
      status: 'answered',
    })
    assert.equal(questions[1].status, 'failed')
    await writeFile(
      cachePath,
      JSON.stringify({
        metadata: { problem_signature: [] },
        answers: { '2': [4] },
      }),
    )
    assert.equal((await library.listQuestions(deck.id))[0].answer, null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('loads legacy caches without manifests and skips corrupt files and backup caches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rain-library-old-'))
  try {
    const dir = join(root, 'ai_answers_cache')
    await mkdir(dir)
    await writeFile(
      join(dir, 'course_deck.json'),
      JSON.stringify({
        metadata: {
          lesson_name: 'course',
          presentation_title: 'deck',
          problem_signature: [{ index: '13' }, { index: '16' }],
        },
        answers: { '13': ['__INSUFFICIENT_CONTEXT__'] },
        manual_answers: { '16': [] },
      }),
    )
    await writeFile(join(dir, 'bad.json'), '{')
    await writeFile(join(dir, 'backup.json.previous-1'), '{}')
    const library = new QuestionLibrary(root)
    const decks = await library.listDecks()
    assert.equal(decks.length, 1)
    assert.deepEqual(
      (await library.listQuestions(decks[0].id)).map((q) => [
        q.index,
        q.status,
      ]),
      [
        ['13', 'context'],
        ['16', 'failed'],
      ],
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('download persists a question manifest independently of AI enablement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rain-manifest-'))
  try {
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
      'base64',
    )
    const result = await downloadPresentation({
      root,
      lessonName: 'course',
      title: 'deck',
      slides: [
        {
          index: 1,
          cover: 'https://example.test/1.png',
          problem: { content: 'Q' },
        },
      ],
      dimensions: { width: 1, height: 1 },
      fetcher: (async () => new Response(bytes)) as typeof fetch,
      logger: { write: async () => undefined } as never,
    })
    const manifest = JSON.parse(
      await readFile(join(result.imageDirectory, 'presentation.json'), 'utf8'),
    )
    assert.equal(manifest.slides[0].problem.content, 'Q')
    const library = new QuestionLibrary(root)
    assert.equal(
      (await library.listQuestions((await library.listDecks())[0].id))[0].text,
      'Q',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
