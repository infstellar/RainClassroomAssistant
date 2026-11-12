import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type WebSocket from 'ws'
import { ClassroomRuntime, presentationIdFromEvent } from './runtime.ts'
import { AiAnalyzer } from './ai-analyzer.ts'
import { readFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import { normalizeConfig } from '../shared/config.ts'
import { AppLogger } from './logger.ts'
import { listAnswerSubmissions } from './answer-submissions.ts'

class FakeSocket extends EventEmitter {
  send() {}
  close() {
    this.emit('close')
  }
  message(event: Record<string, unknown>) {
    this.emit('message', Buffer.from(JSON.stringify(event)))
  }
}

async function until(condition: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 2000
  while (!(await condition())) {
    if (Date.now() > deadline)
      throw new Error('Expected runtime event did not arrive')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('concurrent starts share one poll and stopping during login cancels startup', async () => {
  const originalFetch = globalThis.fetch
  const response = deferred<Response>()
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    return response.promise
  }
  const runtime = new ClassroomRuntime(
    async () => normalizeConfig({ sessionid: 'test' }),
    { write: async () => undefined } as unknown as AppLogger,
    () => undefined,
  )
  try {
    const first = runtime.start()
    const second = runtime.start()
    assert.equal(first, second)
    await until(() => requests === 1)
    await runtime.stop()
    response.resolve(
      Response.json({ code: 0, data: { id: 'user', name: 'Test' } }),
    )
    await first
    assert.equal(runtime.getState().listening, false)
    assert.equal(requests, 1)
  } finally {
    await runtime.stop()
    globalThis.fetch = originalFetch
  }
})

for (const scenario of [
  'choice',
  'multi-blank-object-error',
  'multi-blank-string-error',
  'choice-server-error',
  'transport-error',
] as const) {
  test(`logs submission evidence and preserves correct confirmation state: ${scenario}`, async () => {
    const originalFetch = globalThis.fetch
    const directory = await mkdtemp(join(tmpdir(), 'rainclass-runtime-'))
    const socket = new FakeSocket()
    const config = normalizeConfig({
      sessionid: 'test',
      audio_on: false,
      sign_config: { delay_time: { type: 2 } },
      answer_config: { answer_delay: { type: 4, custom: { percent: 0 } } },
    })
    const submissions: unknown[] = []
    const requestTimes: number[] = []
    const expectedAttempts = scenario.startsWith('multi-blank') ? 2 : 1
    const entries: Array<{ level: string; message: string }> = []
    let connected = false
    let presentationRequested = false
    const pendingPresentation = deferred<Response>()
    const pendingAnswer = deferred<Response>()
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      if (url.includes('/user/basic-info'))
        return Response.json({ code: 0, data: { id: 'user', name: 'Test' } })
      if (url.includes('/classroom/on-lesson'))
        return Response.json({
          code: 0,
          data: {
            onLessonClassrooms: [
              {
                lessonId: 'lesson',
                classroomId: 'class',
                courseName: 'Test course',
              },
            ],
          },
        })
      if (url.includes('/lesson/checkin'))
        return Response.json(
          { code: 0, data: { lessonToken: 'token' } },
          { headers: { 'set-auth': 'lesson-auth' } },
        )
      if (url.includes('/lesson/basic-info'))
        return Response.json({
          code: 0,
          data: { startTime: Date.now(), title: 'Lesson' },
        })
      if (url.includes('presentation_id=pending')) {
        presentationRequested = true
        return pendingPresentation.promise
      }
      if (url.includes('/presentation/fetch'))
        return Response.json({
          code: 0,
          data: {
            title: 'Slides',
            slides: [
              {
                index: 1,
                id: 'slide-alias',
                problem: {
                  problemId: 'problem',
                  problemType: expectedAttempts === 2 ? 4 : 1,
                  answers: ['A'],
                  result: null,
                },
              },
              {
                index: 2,
                problem: {
                  problemId: 'empty',
                  problemType: 1,
                  answers: [],
                  result: null,
                },
              },
            ],
          },
        })
      if (url.includes('/problem/answer')) {
        requestTimes.push(Date.now())
        assert.equal(
          new Headers(init?.headers).get('Authorization'),
          'Bearer lesson-auth',
        )
        submissions.push(JSON.parse(String(init?.body)))
        if (scenario === 'choice') return pendingAnswer.promise
        if (scenario === 'transport-error')
          throw new Error('simulated connection reset')
        if (scenario === 'choice-server-error')
          return Response.json('JsonArray cannot be cast to String', {
            status: 500,
          })
        if (expectedAttempts === 2 && submissions.length === 1) {
          const error =
            'class io.vertx.core.json.JsonArray cannot be cast to class java.lang.String'
          return Response.json(
            scenario === 'multi-blank-object-error'
              ? { code: 500, msg: error }
              : error,
            { status: 500 },
          )
        }
        return Response.json({ code: 0 })
      }
      throw new Error(`Unexpected request: ${url}`)
    }
    const runtime = new ClassroomRuntime(
      async () => config,
      new AppLogger(join(directory, 'logs'), (entry) => entries.push(entry)),
      () => undefined,
      () => undefined,
      () => directory,
      () => {
        connected = true
        return socket as unknown as WebSocket
      },
    )
    try {
      await runtime.start()
      await until(() => connected)
      socket.emit('open')
      socket.message({ op: 'hello', presentation: 'slides' })
      socket.message({
        op: 'probleminfo',
        problemid: 'slide-alias',
        limit: 10,
        now: 10000,
        dt: 10000,
      })
      socket.message({
        op: 'probleminfo',
        problemid: 'problem',
        limit: 10,
        now: 10000,
        dt: 10000,
      })
      if (scenario === 'choice') {
        await until(
          async () => (await listAnswerSubmissions(directory)).length === 1,
        )
        const [pending] = await listAnswerSubmissions(directory)
        assert.equal(pending.status, 'sent')
        assert.equal(submissions.length, 1)
        pendingAnswer.resolve(Response.json({ code: 0 }))
      }
      await until(() =>
        entries.some((entry) => entry.message.includes('处理结束')),
      )
      assert.equal(submissions.length, expectedAttempts)
      const records = await listAnswerSubmissions(directory)
      assert.equal(records.length, expectedAttempts)
      for (const entry of records) {
        assert.equal(entry.problemId, 'problem')
        assert.equal(entry.lessonName, 'Test course')
        assert.equal(entry.title, 'Slides')
        assert.ok(
          requestTimes.some(
            (time) => Math.abs(time - Date.parse(entry.sentAt)) < 50,
          ),
        )
      }
      assert.equal(
        records[0].status,
        scenario === 'transport-error'
          ? 'unknown'
          : scenario === 'choice-server-error'
            ? 'failed'
            : 'success',
      )
      assert.equal(
        (submissions[0] as { problemId: string }).problemId,
        'problem',
      )
      assert.deepEqual((submissions[0] as { result: unknown }).result, ['A'])
      if (expectedAttempts === 2)
        assert.deepEqual((submissions[1] as { result: unknown }).result, {
          '0': 'A',
        })
      const debugMessages = entries
        .filter((entry) => entry.level === 'DEBUG')
        .map((entry) => entry.message)
        .join('\n')
      assert.match(debugMessages, /发送请求/)
      if (
        scenario === 'transport-error' ||
        scenario === 'choice-server-error'
      ) {
        assert.match(debugMessages, /"submitted":false/)
        assert.doesNotMatch(debugMessages, /"submitted":true|"success":true/)
        assert.ok(entries.some((entry) => entry.level === 'ERROR'))
        assert.match(debugMessages, /"retry":false/)
        if (scenario === 'transport-error') {
          assert.match(debugMessages, /"outcome":"unknown"/)
          assert.ok(
            entries.some((entry) => entry.message.includes('提交结果未知')),
          )
        } else {
          assert.match(debugMessages, /收到响应正文/)
          assert.ok(
            entries.some((entry) => entry.message.includes('服务端未确认提交')),
          )
        }
        return
      }
      assert.match(debugMessages, /收到响应正文/)
      assert.match(debugMessages, /"success":true/)
      assert.match(debugMessages, /"submitted":true/)
      assert.doesNotMatch(debugMessages, /lesson-auth|sessionid=test/)
      if (expectedAttempts === 2) assert.match(debugMessages, /"retry":true/)
      socket.message({
        op: 'probleminfo',
        problemid: 'empty',
        limit: 10,
        now: 10000,
        dt: 10000,
      })
      socket.message({
        op: 'probleminfo',
        problemid: 'problem',
        limit: 10,
        now: 10000,
        dt: 10000,
      })
      socket.message({ op: 'presentationupdated', presentation: 'pending' })
      await until(() => presentationRequested)
      socket.message({ op: 'probleminfo', problemid: 'later', limit: -1 })
      await runtime.stop()
      pendingPresentation.resolve(
        Response.json({
          code: 0,
          data: {
            slides: [
              {
                index: 3,
                problem: { problemId: 'later', problemType: 1, answers: ['B'] },
              },
            ],
          },
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 25))
      assert.equal(submissions.length, expectedAttempts)
      assert.equal(runtime.getState().courses, 0)
      assert.deepEqual(runtime.getCourses(), [])
    } finally {
      await runtime.stop()
      globalThis.fetch = originalFetch
      await rm(directory, { recursive: true, force: true })
    }
  })
}

test('extracts deck IDs without mistaking slide IDs or objects for a deck', () => {
  for (const event of [
    { presentation: 'deck' },
    { pres: 'deck' },
    { presentationId: 'deck' },
    { presentation_id: 'deck' },
    { slide: { pres: 'deck' } },
    { slide: { presentation: 'deck' } },
  ])
    assert.equal(presentationIdFromEvent(event), 'deck')
  assert.equal(presentationIdFromEvent({ presentation: 123 }), '123')
  for (const event of [
    { sid: 'slide' },
    { presentation: {} },
    { pres: '' },
    { pres: true },
  ])
    assert.equal(presentationIdFromEvent(event), undefined)
})

for (const retryFailure of [false, true]) {
  test(`switching decks downloads then analyzes, deduplicates navigation and serializes updates (failure=${retryFailure})`, async () => {
    const originalFetch = globalThis.fetch
    const originalAnalyze = AiAnalyzer.prototype.analyzePresentation
    const directory = await mkdtemp(join(tmpdir(), 'rain-switch-'))
    const socket = new FakeSocket()
    const requests: string[] = []
    const analysis: string[] = []
    const entries: string[] = []
    const pendingAi = deferred<void>()
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=',
      'base64',
    )
    let broken = retryFailure
    let imageDownloads = 0
    globalThis.fetch = async (input) => {
      const url = String(input)
      if (url.includes('/user/basic-info'))
        return Response.json({ code: 0, data: { id: 'user', name: 'Test' } })
      if (url.includes('/classroom/on-lesson'))
        return Response.json({
          code: 0,
          data: {
            onLessonClassrooms: [
              {
                lessonId: 'lesson',
                classroomId: 'class',
                courseName: 'Course',
              },
            ],
          },
        })
      if (url.includes('/lesson/checkin'))
        return Response.json({ code: 0, data: { lessonToken: 'token' } })
      if (url.includes('/lesson/basic-info'))
        return Response.json({
          code: 0,
          data: { startTime: Date.now(), title: 'Lesson' },
        })
      if (url.includes('/presentation/fetch')) {
        const id = new URL(url).searchParams.get('presentation_id')!
        requests.push(id)
        return Response.json({
          code: 0,
          data: {
            title: id,
            width: 800,
            height: 600,
            slides: [
              {
                index: 1,
                cover: broken ? undefined : `https://assets.example/${id}.png`,
                problem: {
                  problemId: `${id}-problem`,
                  problemType: 1,
                  answers: ['A'],
                },
              },
            ],
          },
        })
      }
      if (url.startsWith('https://assets.example/')) {
        imageDownloads++
        return new Response(png)
      }
      throw new Error(`Unexpected request: ${url}`)
    }
    AiAnalyzer.prototype.analyzePresentation = async function (
      _course,
      title,
      _slides,
      imageDirectory,
    ) {
      assert.deepEqual(await readFile(join(imageDirectory, '1.jpg')), png)
      const pdf = await PDFDocument.load(
        await readFile(join(directory, 'downloads', 'Course', `${title}.pdf`)),
      )
      assert.equal(pdf.getPageCount(), 1)
      analysis.push(title)
      if (title === 'B' && analysis.filter((id) => id === 'B').length === 1)
        await pendingAi.promise
    }
    const runtime = new ClassroomRuntime(
      async () =>
        normalizeConfig({
          sessionid: 'test',
          audio_on: false,
          auto_answer: false,
          auto_danmu: false,
          sign_config: { delay_time: { type: 2 } },
        }),
      {
        write: async (_level: string, _source: string, message: string) => {
          entries.push(message)
        },
      } as unknown as AppLogger,
      () => undefined,
      () => undefined,
      () => directory,
      () => socket as unknown as WebSocket,
    )
    try {
      await runtime.start()
      await until(() => socket.listenerCount('message') > 0)
      socket.message({ op: 'hello', presentation: 'A' })
      if (retryFailure) {
        await until(() =>
          entries.some((message) => message.includes('下次课件事件将重试')),
        )
        broken = false
        socket.message({ op: 'showpresentation', presentation: 'A' })
      }
      await until(() => analysis.includes('A'))
      socket.message({ op: 'showpresentation', presentation: 'B' })
      for (let i = 0; i < 20; i++)
        socket.message({
          op: 'slidenav',
          slide: { pres: 'B', sid: `page-${i}` },
        })
      await until(() => analysis.includes('B'))
      socket.message({ op: 'showpresentation', presentation: 'A' })
      socket.message({ op: 'presentationcreated', presentation: 'B' })
      socket.message({ op: 'presentationupdated', presentation: 'B' })
      await until(() => requests.filter((id) => id === 'B').length === 2)
      assert.equal(imageDownloads, 2) // Updated B waits for the first analysis.
      pendingAi.resolve()
      await until(() => analysis.filter((id) => id === 'B').length === 2)
      assert.deepEqual(
        requests,
        retryFailure ? ['A', 'A', 'B', 'B'] : ['A', 'B', 'B'],
      )
      assert.equal(imageDownloads, 3)
      assert.deepEqual(analysis, ['A', 'B', 'B'])
      socket.message({ op: 'slidenav', pres: 'C' }) // Navigation also recovers a missed switch.
      await until(() => analysis.includes('C'))
      socket.message({ op: 'showpresentation' })
      await until(() =>
        entries.some((message) =>
          message.includes('showpresentation 消息缺少课件 ID'),
        ),
      )
      assert.equal(requests.at(-1), 'C')
    } finally {
      pendingAi.resolve()
      await runtime.stop()
      globalThis.fetch = originalFetch
      AiAnalyzer.prototype.analyzePresentation = originalAnalyze
      await rm(directory, { recursive: true, force: true })
    }
  })
}
