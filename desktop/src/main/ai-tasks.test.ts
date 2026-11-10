import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AiAnalyzer } from './ai-analyzer.ts'
import { aiSession, listAiTasks, saveAiTask } from './ai-tasks.ts'
import { QuestionLibrary } from './question-library.ts'
import { defaultConfig } from '../shared/config.ts'

test('tracks active requests, raw SSE and question answer times', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'rain-task-history-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, 'downloads', 'rainclasscache', 'course', 'deck')
  await mkdir(directory, { recursive: true })
  const slides = [{ index: 1, problem: { id: 'question-1' } }]
  await writeFile(
    join(directory, 'presentation.json'),
    JSON.stringify({ lessonName: 'course', title: 'deck', slides }),
  )
  await writeFile(join(directory, '1.jpg'), Buffer.from('ffd8', 'hex'))
  const raw =
    'data: {"type":"response.completed","response":{"status":"completed","output_text":"[2]"}}\n\n'
  t.mock.method(globalThis, 'fetch', async () => {
    const [task] = await listAiTasks(root)
    assert.equal(task.status, 'running')
    assert.equal(task.attempts.length, 1)
    return new Response(raw, {
      headers: { 'content-type': 'text/event-stream' },
    })
  })
  const config = {
    ...defaultConfig,
    enable_ai_analysis: true,
    openai_api_key: 'secret-test-key',
  }
  const analyzer = new AiAnalyzer(
    async () => config,
    { write: async () => undefined } as never,
    root,
  )
  await analyzer.analyzeLiveSlide(
    'course',
    'deck',
    '1',
    join(directory, '1.jpg'),
    slides,
  )
  const [task] = await listAiTasks(root)
  assert.equal(task.status, 'completed')
  assert.equal(task.attempts[0].rawResponse, raw)
  const library = new QuestionLibrary(root)
  const [deck] = await library.listDecks()
  const [question] = await library.listQuestions(deck.id)
  assert.equal(question.answeredAt, task.completedAt)
  assert.equal(question.aiHistory[0].id, task.id)
  const [manual] = await library.saveManualAnswer(deck.id, '1', 'C')
  assert.equal(manual.source, 'manual')
  assert.ok(manual.answeredAt)
  assert.equal(manual.aiHistory.length, 1)
  const [restored] = await library.saveManualAnswer(deck.id, '1', '')
  assert.equal(restored.answeredAt, task.completedAt)
  await writeFile(
    join(directory, 'presentation.json'),
    JSON.stringify({
      lessonName: 'course',
      title: 'deck',
      slides: [{ index: 1, problem: { id: 'changed' } }],
    }),
  )
  const [changed] = await library.listQuestions(deck.id)
  assert.equal(changed.answer, null)
  assert.deepEqual(changed.aiHistory, [])
})

test('retains redacted failures and detects interrupted sessions', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'rain-task-failure-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('invalid secret-test-key', { status: 401 }),
  )
  const analyzer = new AiAnalyzer(
    async () => defaultConfig,
    { write: async () => undefined } as never,
    root,
  )
  await analyzer.testService({
    ...defaultConfig,
    openai_api_key: 'secret-test-key',
  })
  const [task] = await listAiTasks(root)
  assert.equal(task.status, 'failed')
  assert.ok(task.completedAt)
  assert.match(task.attempts[0].rawResponse, /REDACTED/)
  assert.ok(!JSON.stringify(task).includes('secret-test-key'))
  await saveAiTask(root, {
    ...task,
    session: 'previous-session',
    status: 'running',
  })
  assert.equal((await listAiTasks(root))[0].status, 'interrupted')
  await saveAiTask(root, { ...task, session: aiSession, status: 'retrying' })
  assert.equal((await listAiTasks(root))[0].status, 'retrying')
})
