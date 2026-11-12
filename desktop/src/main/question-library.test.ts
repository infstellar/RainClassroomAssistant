import assert from 'node:assert/strict'
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  utimes,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { QuestionLibrary } from './question-library.ts'
import { problemSignature } from './answer-cache.ts'
import { downloadPresentation } from './presentation.ts'
import { saveAnswerSubmission } from './answer-submissions.ts'

test('lists newest downloaded decks first and uses cache time only for legacy decks', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'rain-library-order-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const cacheRoot = join(root, 'ai_answers_cache')
  await mkdir(cacheRoot, { recursive: true })
  for (const [title, day] of [
    ['A-old', 1],
    ['Z-new', 3],
    ['M-middle', 2],
  ] as const) {
    const directory = join(root, 'downloads', 'rainclasscache', 'course', title)
    await mkdir(directory, { recursive: true })
    const manifest = join(directory, 'presentation.json')
    await writeFile(
      manifest,
      JSON.stringify({
        lessonName: 'course',
        title,
        slides: [{ index: 1, problem: {} }],
      }),
    )
    const time = new Date(`2026-11-0${day}T00:00:00Z`)
    await utimes(manifest, time, time)
  }
  // Editing an old deck's answers must not make it the newest downloaded deck.
  await writeFile(
    join(cacheRoot, 'course_A-old.json'),
    JSON.stringify({
      metadata: { lesson_name: 'course', presentation_title: 'A-old' },
      answers: { '1': [1] },
    }),
  )
  const legacy = join(cacheRoot, 'course_legacy.json')
  await writeFile(
    legacy,
    JSON.stringify({
      metadata: { lesson_name: 'course', presentation_title: 'legacy' },
      answers: { '1': [1] },
    }),
  )
  const legacyTime = new Date('2026-11-02T12:00:00Z')
  await utimes(legacy, legacyTime, legacyTime)
  const library = new QuestionLibrary(root)
  assert.deepEqual(
    (await library.listDecks()).map((deck) => deck.title),
    ['Z-new', 'legacy', 'M-middle', 'A-old'],
  )
})

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
      submissionSentAt: null,
      submissionStatus: null,
      aiHistory: [],
      index: '2',
      text: '题目二',
      aiAnswer: [1],
      answer: [3],
      source: 'manual',
      status: 'answered',
    })
    assert.equal(questions[1].status, 'failed')
    // Live events number the same question differently from the saved manifest.
    await writeFile(
      cachePath,
      JSON.stringify({
        metadata: {
          problem_signature: [
            { index: '1', id: 'p2' },
            { index: '9', id: 'p10' },
          ],
        },
        answers: { '1': [1], '9': [2] },
        manual_answers: { '1': [3] },
      }),
    )
    const renumbered = await library.listQuestions(deck.id)
    assert.deepEqual(
      renumbered.map((q) => [q.index, q.aiAnswer, q.answer]),
      [
        ['2', [1], [3]],
        ['10', [2], [2]],
      ],
    )
    await library.saveManualAnswer(deck.id, '2', 'D')
    assert.deepEqual((await library.listQuestions(deck.id))[0].answer, ['D'])
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

test('shows the latest request time by problem identity across renumbering and answer edits', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'rain-submission-library-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dir = join(root, 'downloads', 'rainclasscache', 'course', 'deck')
  await mkdir(dir, { recursive: true })
  const manifest = join(dir, 'presentation.json')
  await writeFile(
    manifest,
    JSON.stringify({
      lessonName: 'course',
      title: 'deck',
      slides: [{ index: 2, problem: { id: 'p2' } }],
    }),
  )
  const entry = {
    id: 'first',
    lessonName: 'course',
    lessonId: 'lesson',
    title: 'deck',
    slideIndex: '1',
    problemId: 'p2',
    sentAt: '2026-11-12T01:00:00.000Z',
    status: 'success' as const,
  }
  await saveAnswerSubmission(root, entry)
  await saveAnswerSubmission(root, {
    ...entry,
    id: 'second',
    sentAt: '2026-11-12T02:00:00.000Z',
    status: 'unknown',
  })
  await saveAnswerSubmission(root, {
    ...entry,
    id: 'other-course',
    lessonName: 'other',
    sentAt: '2026-11-12T03:00:00.000Z',
  })
  await writeFile(join(root, 'answer_submissions', 'corrupt.json'), '{')
  const library = new QuestionLibrary(root)
  const [deck] = await library.listDecks()
  const [question] = await library.listQuestions(deck.id)
  assert.equal(question.answer, null)
  assert.equal(question.submissionSentAt, '2026-11-12T02:00:00.000Z')
  assert.equal(question.submissionStatus, 'unknown')
  const [manual] = await library.saveManualAnswer(deck.id, '2', 'D')
  assert.equal(manual.submissionSentAt, question.submissionSentAt)
  assert.equal(manual.submissionStatus, 'unknown')
  await writeFile(
    manifest,
    JSON.stringify({
      lessonName: 'course',
      title: 'deck',
      slides: [{ index: 2, problem: { id: 'different-problem' } }],
    }),
  )
  const [changed] = await library.listQuestions(deck.id)
  assert.equal(changed.submissionSentAt, null)
  assert.equal(changed.submissionStatus, null)
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
