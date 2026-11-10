import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type WebSocket from 'ws'
import { ClassroomRuntime } from './runtime.ts'
import { normalizeConfig } from '../shared/config.ts'
import { AppLogger } from './logger.ts'

class FakeSocket extends EventEmitter {
  send() {}
  close() {
    this.emit('close')
  }
  message(event: Record<string, unknown>) {
    this.emit('message', Buffer.from(JSON.stringify(event)))
  }
}

async function until(condition: () => boolean) {
  const deadline = Date.now() + 2000
  while (!condition()) {
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
    const expectedAttempts = scenario.startsWith('multi-blank') ? 2 : 1
    const entries: Array<{ level: string; message: string }> = []
    let connected = false
    let presentationRequested = false
    const pendingPresentation = deferred<Response>()
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
        assert.equal(
          new Headers(init?.headers).get('Authorization'),
          'Bearer lesson-auth',
        )
        submissions.push(JSON.parse(String(init?.body)))
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
      await until(() =>
        entries.some((entry) => entry.message.includes('处理结束')),
      )
      assert.equal(submissions.length, expectedAttempts)
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
