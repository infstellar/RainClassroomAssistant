import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  AiAnalyzer,
  buildAiRequest,
  consumeSse,
  parseAnswerArray,
  parseSseEvents,
} from './ai-analyzer.ts'
import { defaultConfig } from '../shared/config.ts'

test('builds Responses and Chat Completions image payloads from config', () => {
  const image = [{ mime: 'image/png', base64: 'YWJj' }]
  const responses = buildAiRequest(
    {
      ...defaultConfig,
      openai_api_base: 'https://api.example/v1/',
      openai_model: 'vision',
    },
    image,
    'prompt',
  )
  assert.equal(responses.url, 'https://api.example/v1/responses')
  assert.deepEqual(
    responses.payload.input &&
      (
        responses.payload.input as Array<{
          content: Array<Record<string, unknown>>
        }>
      )[0].content[1],
    { type: 'input_image', image_url: 'data:image/png;base64,YWJj' },
  )

  const config = {
    ...defaultConfig,
    ai_analysis_settings: {
      ...defaultConfig.ai_analysis_settings,
      protocol: 'chat_completions' as const,
      max_output_tokens: 200,
    },
  }
  const chat = buildAiRequest(config, image, 'prompt')
  assert.equal(chat.url, 'https://api.openai.com/v1/chat/completions')
  assert.equal(chat.payload.max_tokens, 200)
  assert.deepEqual(parseAnswerArray('[1,"c"]'), [1, 'C'])
})

test('parses multiline SSE and aggregates output and reasoning deltas', async () => {
  const events = [
    { type: 'response.output_text.delta', delta: '[1' },
    { type: 'response.output_text.delta', delta: ',2]' },
    {
      type: 'response.reasoning_summary_text.delta',
      item_id: 'r1',
      summary_index: 0,
      delta: 'checked ',
    },
    {
      type: 'response.reasoning_summary_text.delta',
      item_id: 'r1',
      summary_index: 0,
      delta: 'context',
    },
    { type: 'response.completed', response: { status: 'completed' } },
  ]
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join('')
  assert.equal(parseSseEvents('data: one\ndata: two\n\n')[0], 'one\ntwo')
  const logged: string[] = []
  const answer = await consumeSse(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body))
        controller.close()
      },
    }),
    'responses',
    {
      write: async (_level: string, _source: string, message: string) => {
        logged.push(message)
      },
    } as never,
  )
  assert.equal(answer, '[1,2]')
  assert.deepEqual(logged, ['推理摘要：checked context'])
})

test('rejects incomplete Responses streams and recognizes insufficient context', async () => {
  const body = `data: ${JSON.stringify({ type: 'response.incomplete', response: { status: 'incomplete' } })}\n\n`
  await assert.rejects(
    () =>
      consumeSse(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(body))
            controller.close()
          },
        }),
        'responses',
        { write: async () => undefined } as never,
      ),
    /未完成/,
  )
  assert.deepEqual(parseAnswerArray('["上下文不足"]'), [
    '__INSUFFICIENT_CONTEXT__',
  ])
  assert.deepEqual(parseAnswerArray('[]'), [])
})

test('analyzes a cached slide image through HTTP and persists the answer cache', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rain-ai-'))
  const imageDir = join(root, 'downloads', 'rainclasscache', 'lesson', 'deck')
  await mkdir(imageDir, { recursive: true })
  await writeFile(
    join(imageDir, '3.jpg'),
    Buffer.from('ffd8ffe000104a464946', 'hex'),
  )
  let requestBody: Record<string, unknown> | undefined
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requestBody = JSON.parse(Buffer.concat(chunks).toString()) as Record<
      string,
      unknown
    >
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ output_text: '[2]', status: 'completed' }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const config = {
    ...defaultConfig,
    enable_ai_analysis: true,
    openai_api_key: 'test-key',
    openai_api_base: `http://127.0.0.1:${address.port}/v1`,
    ai_analysis_settings: {
      ...defaultConfig.ai_analysis_settings,
      stream: false,
      delay_between_requests: 0,
    },
  }
  try {
    const analyzer = new AiAnalyzer(
      async () => config,
      { write: async () => undefined } as never,
      root,
    )
    await analyzer.analyzePresentation(
      'lesson',
      'deck',
      [{ index: 3, problem: {} }],
      imageDir,
    )
    assert.equal(requestBody?.model, config.openai_model)
    const cache = JSON.parse(
      await readFile(
        join(root, 'ai_answers_cache', 'lesson_deck.json'),
        'utf8',
      ),
    ) as { answers: Record<string, unknown> }
    assert.deepEqual(cache.answers['3'], [2])
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
    await rm(root, { recursive: true, force: true })
  }
})

test('analyzes a live slide and merges its answer into an existing cache', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rain-live-ai-'))
  const imagePath = join(root, 'slide.jpg')
  await writeFile(imagePath, Buffer.from('ffd8ffe000104a464946', 'hex'))
  const cacheDirectory = join(root, 'ai_answers_cache')
  await mkdir(cacheDirectory, { recursive: true })
  await writeFile(
    join(cacheDirectory, 'lesson_deck.json'),
    JSON.stringify({
      metadata: {},
      answers: { '2': ['A'] },
      manual_answers: { '4': ['B'] },
    }),
  )
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ output_text: '[3]' }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const config = {
    ...defaultConfig,
    enable_ai_analysis: true,
    openai_api_key: 'test-key',
    openai_api_base: `http://127.0.0.1:${address.port}/v1`,
    ai_analysis_settings: {
      ...defaultConfig.ai_analysis_settings,
      stream: false,
    },
  }
  try {
    const analyzer = new AiAnalyzer(
      async () => config,
      { write: async () => undefined } as never,
      root,
    )
    assert.deepEqual(
      await analyzer.analyzeLiveSlide('lesson', 'deck', '5', imagePath),
      [3],
    )
    const cache = JSON.parse(
      await readFile(join(cacheDirectory, 'lesson_deck.json'), 'utf8'),
    ) as {
      answers: Record<string, unknown>
      manual_answers: Record<string, unknown>
    }
    assert.deepEqual(cache.answers, { '2': ['A'], '5': [3] })
    assert.deepEqual(cache.manual_answers, { '4': ['B'] })
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
    await rm(root, { recursive: true, force: true })
  }
})

test('retries a live answer with earlier slide context when the model requests it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rain-live-context-'))
  const imageDirectory = join(root, 'slides')
  await mkdir(imageDirectory, { recursive: true })
  await writeFile(
    join(imageDirectory, '4.jpg'),
    Buffer.from('ffd8ffe000104a464946', 'hex'),
  )
  await writeFile(
    join(imageDirectory, '5.jpg'),
    Buffer.from('ffd8ffe000104a4646', 'hex'),
  )
  let requests = 0
  let contextImageCount = 0
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      input?: Array<{ content?: unknown[] }>
    }
    requests += 1
    contextImageCount =
      body.input?.[0].content?.filter(
        (item) => (item as { type?: string }).type === 'input_image',
      ).length ?? 0
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        output_text: requests === 1 ? '["上下文不足"]' : '[1]',
      }),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const config = {
    ...defaultConfig,
    enable_ai_analysis: true,
    openai_api_key: 'test-key',
    openai_api_base: `http://127.0.0.1:${address.port}/v1`,
    ai_analysis_settings: {
      ...defaultConfig.ai_analysis_settings,
      stream: false,
    },
  }
  try {
    const analyzer = new AiAnalyzer(
      async () => config,
      { write: async () => undefined } as never,
      root,
    )
    const answer = await analyzer.analyzeLiveSlide(
      'lesson',
      'deck',
      '5',
      join(imageDirectory, '5.jpg'),
      [{ index: 4 }, { index: 5 }],
      imageDirectory,
    )
    assert.deepEqual(answer, [1])
    assert.equal(requests, 2)
    assert.equal(contextImageCount, 2)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
    await rm(root, { recursive: true, force: true })
  }
})
