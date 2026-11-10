import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AiServiceTestResult, AssistantConfig } from '../shared/contract'
import type { AppLogger } from './logger'
import { resolveCachedAnswer } from './answer-cache.ts'
import {
  downloadSlideImage,
  safePathComponent,
  slideImagePath,
  type SlideData,
} from './presentation.ts'
import { writeAnswerCache } from './cache-store.ts'

export const insufficientContext = '__INSUFFICIENT_CONTEXT__'

export function parseAnswerArray(text: string): unknown[] {
  const match = text.match(/\[[\s\S]*?\]/)
  if (!match) return []
  try {
    const parsed: unknown = JSON.parse(match[0])
    if (!Array.isArray(parsed)) return []
    if (
      parsed.length === 1 &&
      typeof parsed[0] === 'string' &&
      /^(上下文不足|context insufficient|insufficient context|INSUFFICIENT_CONTEXT)$/i.test(
        parsed[0].trim(),
      )
    )
      return [insufficientContext]
    return parsed.map((value) =>
      typeof value === 'string' && /^[a-z]$/i.test(value)
        ? value.toUpperCase()
        : value,
    )
  } catch {
    const body = match[0].slice(1, -1).trim()
    if (!body) return []
    return body.split(',').map((part) => {
      const item = part.trim().replace(/^['"]|['"]$/g, '')
      return /^\d+$/.test(item)
        ? Number(item)
        : /^[a-z]$/i.test(item)
          ? item.toUpperCase()
          : item
    })
  }
}

export function buildAiRequest(
  config: AssistantConfig,
  images: Array<{ mime: string; base64: string }>,
  prompt: string,
) {
  if (!images.length) throw new Error('至少需要一张图片')
  const settings = config.ai_analysis_settings
  const base = config.openai_api_base.replace(/\/+$/, '')
  if (settings.protocol === 'chat_completions') {
    const content: Array<Record<string, unknown>> = [
      { type: 'text', text: prompt },
      ...images.map(({ mime, base64 }) => ({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${base64}` },
      })),
    ]
    const payload: Record<string, unknown> = {
      model: config.openai_model,
      messages: [{ role: 'user', content }],
      stream: settings.stream !== false,
    }
    if (
      settings.max_output_tokens !== null &&
      settings.max_output_tokens !== undefined
    )
      payload.max_tokens = settings.max_output_tokens
    return { url: `${base}/chat/completions`, payload }
  }
  const reasoning: Record<string, unknown> = {
    effort: settings.reasoning_effort ?? 'high',
  }
  if (settings.reasoning_summary) reasoning.summary = settings.reasoning_summary
  const content = [
    { type: 'input_text', text: prompt },
    ...images.map(({ mime, base64 }) => ({
      type: 'input_image',
      image_url: `data:${mime};base64,${base64}`,
    })),
  ]
  const payload: Record<string, unknown> = {
    model: config.openai_model,
    reasoning,
    input: [{ role: 'user', content }],
    stream: settings.stream !== false,
  }
  if (
    settings.max_output_tokens !== null &&
    settings.max_output_tokens !== undefined
  )
    payload.max_output_tokens = settings.max_output_tokens
  return { url: `${base}/responses`, payload }
}

function extractOutput(data: Record<string, unknown>) {
  if (typeof data.output_text === 'string' && data.output_text)
    return data.output_text
  const output = Array.isArray(data.output)
    ? (data.output as Record<string, unknown>[])
    : []
  const content = output
    .filter((item) => item.type !== 'reasoning')
    .flatMap((item) =>
      Array.isArray(item.content)
        ? (item.content as Record<string, unknown>[])
        : [],
    )
  const texts = content
    .map((item) => item.text)
    .filter((text): text is string => typeof text === 'string')
  if (texts.length) return texts.join('')
  const choices = Array.isArray(data.choices)
    ? (data.choices as Record<string, unknown>[])
    : []
  const message = choices[0]?.message as Record<string, unknown> | undefined
  return typeof message?.content === 'string' ? message.content : ''
}

export function parseSseEvents(text: string) {
  const events: string[] = []
  let parts: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line) {
      if (parts.length) events.push(parts.join('\n'))
      parts = []
    } else if (line.startsWith('data:'))
      parts.push(line.slice(5).replace(/^ /, ''))
  }
  if (parts.length) events.push(parts.join('\n'))
  return events
}

export async function consumeSse(
  stream: ReadableStream<Uint8Array>,
  protocol: string,
  logger: AppLogger,
) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let completed = false
  let finalText: string | undefined
  const summaries = new Map<string, string>()
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const chunks = buffer.split(/\r?\n\r?\n/)
      buffer = chunks.pop() ?? ''
      if (done && buffer) chunks.push(buffer)
      for (const chunk of chunks) {
        const payload = parseSseEvents(chunk)[0]
        if (!payload) continue
        if (payload === '[DONE]') {
          completed = true
          break
        }
        const event = JSON.parse(payload) as Record<string, unknown>
        const type = String(event.type ?? '')
        if (event.error || type === 'error')
          throw new Error(
            `AI 流式请求失败：${JSON.stringify(event.error ?? event)}`,
          )
        if (
          [
            'response.completed',
            'response.incomplete',
            'response.failed',
          ].includes(type)
        ) {
          const response = (event.response ?? {}) as Record<string, unknown>
          if (
            type !== 'response.completed' ||
            (response.status && response.status !== 'completed')
          )
            throw new Error(`AI 响应未完成：${type}`)
          finalText = extractOutput(response) || finalText
          const output = Array.isArray(response.output)
            ? (response.output as Record<string, unknown>[])
            : []
          const summary = output
            .filter((item) => item.type === 'reasoning')
            .flatMap((item) =>
              Array.isArray(item.summary)
                ? (item.summary as Record<string, unknown>[])
                : [],
            )
            .map((item) => item.text)
            .filter((item): item is string => typeof item === 'string')
            .join('\n')
          if (summary) summaries.set('final', summary)
          completed = true
          break
        }
        if (type === 'response.output_text.delta')
          text += String(event.delta ?? '')
        else if (type === 'response.output_text.done' && !text)
          finalText = String(event.text ?? '')
        else if (type === 'response.reasoning_summary_text.delta') {
          const key = `${event.item_id ?? event.output_index ?? 0}:${event.summary_index ?? 0}`
          summaries.set(
            key,
            (summaries.get(key) ?? '') + String(event.delta ?? ''),
          )
        } else if (type === 'response.reasoning_summary_text.done') {
          const key = `${event.item_id ?? event.output_index ?? 0}:${event.summary_index ?? 0}`
          if (event.text) summaries.set(key, String(event.text))
        } else {
          const choices = Array.isArray(event.choices)
            ? (event.choices as Record<string, unknown>[])
            : []
          const choice = choices[0]
          const delta = choice?.delta as Record<string, unknown> | undefined
          if (typeof delta?.content === 'string') text += delta.content
          if (
            choice?.finish_reason === 'length' ||
            choice?.finish_reason === 'content_filter'
          )
            throw new Error(`AI 答案被截断：${choice.finish_reason}`)
        }
      }
      if (completed || done) break
    }
  } finally {
    reader.releaseLock()
  }
  if (!completed) throw new Error(`${protocol} 流中断，未收到完成事件`)
  const summary = [...summaries.values()].filter(Boolean).join('\n')
  if (summary) await logger.write('INFO', 'AI 分析', `推理摘要：${summary}`)
  return (finalText ?? text).trim()
}

const singlePrompt =
  '请分析这张PPT图片中的题目并提供正确答案。选择题返回正确选项序号，如[1,2]表示A、B选项正确；没有题目返回[]；如缺少必要上下文无法可靠作答，只返回["上下文不足"]。只输出答案数组，不要过程、Markdown或LaTeX。'

export class AiAnalyzer {
  private readonly getConfig: () => Promise<AssistantConfig>
  private readonly logger: AppLogger
  private readonly root: string
  constructor(
    getConfig: () => Promise<AssistantConfig>,
    logger: AppLogger,
    root = process.cwd(),
  ) {
    this.getConfig = getConfig
    this.logger = logger
    this.root = root
  }

  async testService(config: AssistantConfig): Promise<AiServiceTestResult> {
    const start = Date.now()
    try {
      if (!config.openai_api_key.trim()) throw new Error('请先填写 API 密钥')
      if (!config.openai_model.trim()) throw new Error('请先填写模型名称')
      const url = new URL(config.openai_api_base)
      if (!['https:', 'http:'].includes(url.protocol))
        throw new Error('API 地址必须为 HTTP 或 HTTPS')
      const answer = await this.analyze(
        {
          ...config,
          ai_analysis_settings: {
            ...config.ai_analysis_settings,
            max_retries: 0,
          },
        },
        [
          {
            mime: 'image/png',
            base64:
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
          },
        ],
        '这是图片接口连接测试。请确认收到图片后只返回数组[1]。',
        'AI 服务测试',
      )
      if (JSON.stringify(answer) !== '[1]')
        throw new Error(
          '接口已返回，但未获得预期测试答案 [1]，请检查模型及响应格式',
        )
      return {
        ok: true,
        message: '图片请求测试成功，模型已返回预期答案',
        elapsedMs: Date.now() - start,
      }
    } catch (error) {
      let message = describeRequestError(error)
      if (config.openai_api_key)
        message = message.split(config.openai_api_key).join('[REDACTED]')
      return { ok: false, message, elapsedMs: Date.now() - start }
    }
  }

  async analyzePresentation(
    lessonName: string,
    title: string,
    slides: SlideData[],
    imageDir: string,
  ) {
    const config = await this.getConfig()
    if (!config.enable_ai_analysis || !config.openai_api_key) return
    const cachePath = join(
      this.root,
      'ai_answers_cache',
      `${safePathComponent(lessonName)}_${safePathComponent(title)}.json`,
    )
    const answers: Record<string, unknown> = {}
    const failed: SlideData[] = []
    const problemSlides = slides.filter((slide) => slide.problem)
    for (const slide of problemSlides) {
      const index = String(slide.index)
      try {
        const existing = JSON.parse(
          await readFile(cachePath, 'utf8'),
        ) as unknown
        const cached = resolveCachedAnswer(existing, index, slides)
        if (cached) {
          answers[index] = cached
          continue
        }
      } catch {
        /* No cache yet. */
      }
      try {
        const bytes = new Uint8Array(
          await readFile(slideImagePath(imageDir, slide.index)),
        )
        const image = {
          mime: bytes[0] === 0x89 ? 'image/png' : 'image/jpeg',
          base64: Buffer.from(bytes).toString('base64'),
        }
        const requestLabel = `${title} 第 ${index} 页`
        let answer = await this.analyze(
          config,
          [image],
          singlePrompt,
          requestLabel,
        )
        if (answer.length === 1 && answer[0] === insufficientContext) {
          for (const count of [3, 5, 7, 9]) {
            const position = slides.findIndex(
              (candidate) => String(candidate.index) === index,
            )
            const context = slides.slice(
              Math.max(0, position - count + 1),
              position + 1,
            )
            const images = []
            for (const item of context) {
              try {
                const data = new Uint8Array(
                  await readFile(slideImagePath(imageDir, item.index)),
                )
                images.push({
                  mime: data[0] === 0x89 ? 'image/png' : 'image/jpeg',
                  base64: Buffer.from(data).toString('base64'),
                })
              } catch {
                /* Skip unavailable context images. */
              }
            }
            if (images.length < 2) continue
            const prompt = `请根据多张PPT图片回答最后一张图片(slide=${index})中的题目。前面的图片只作上下文。若上下文不足只返回["上下文不足"]；没有题目返回[]。只输出答案数组，不要解释。`
            answer = await this.analyze(config, images, prompt, requestLabel)
            if (answer.length !== 1 || answer[0] !== insufficientContext) break
          }
        }
        if (
          answer.length &&
          !(answer.length === 1 && answer[0] === insufficientContext)
        )
          answers[index] = answer
        else failed.push(slide)
      } catch (error) {
        failed.push(slide)
        await this.logger.write(
          'WARNING',
          'AI 分析',
          `${title} 第 ${index} 页失败：${error instanceof Error ? error.message : '未知错误'}`,
        )
      }
      await writeAnswerCache(
        cachePath,
        {
          lesson_name: lessonName,
          presentation_title: title,
          analysis_status: 'analyzing',
          version: '2.1',
        },
        answers,
        failed.map((item) => String(item.index)),
        slides,
      )
      const delay = Number(
        config.ai_analysis_settings.delay_between_requests ?? 1,
      )
      if (delay > 0)
        await new Promise((resolve) => setTimeout(resolve, delay * 1000))
    }
    await writeAnswerCache(
      cachePath,
      {
        lesson_name: lessonName,
        presentation_title: title,
        analysis_status: failed.length
          ? Object.keys(answers).length
            ? 'partial'
            : 'failed'
          : 'completed',
        version: '2.1',
      },
      answers,
      failed.map((slide) => String(slide.index)),
      slides,
    )
    await this.logger.write(
      failed.length ? 'WARNING' : 'INFO',
      'AI 分析',
      failed.length
        ? `${title} 分析结束，获得答案 ${Object.keys(answers).length} 道，未获得答案 ${failed.length} 页（${failed.map((slide) => slide.index).join('、')}），可重新分析以补全`
        : `${title} 分析完成，获得答案 ${Object.keys(answers).length} 道`,
    )
  }

  async analyzeLiveSlide(
    lessonName: string,
    title: string,
    slideIndex: string,
    imagePath: string,
    slides: SlideData[] = [],
    imageDirectory = '',
  ) {
    const config = await this.getConfig()
    if (!config.enable_ai_analysis || !config.openai_api_key) return undefined
    const bytes = new Uint8Array(await readFile(imagePath))
    const image = {
      mime: bytes[0] === 0x89 ? 'image/png' : 'image/jpeg',
      base64: Buffer.from(bytes).toString('base64'),
    }
    const requestLabel = `${title} 第 ${slideIndex} 页现场分析`
    let answer = await this.analyze(config, [image], singlePrompt, requestLabel)
    if (
      answer.length === 1 &&
      answer[0] === insufficientContext &&
      imageDirectory
    ) {
      const position = slides.findIndex(
        (slide) => String(slide.index) === slideIndex,
      )
      for (const count of [3, 5, 7, 9]) {
        if (position < 0) break
        const context = slides.slice(
          Math.max(0, position - count + 1),
          position + 1,
        )
        const images = []
        for (const slide of context) {
          const path = slideImagePath(imageDirectory, slide.index)
          try {
            if (String(slide.index) !== slideIndex)
              await readFile(path).catch(async () => {
                if (!slide.cover) throw new Error('缺少上下文图片')
                await downloadSlideImage(slide.cover, path)
              })
            const data = new Uint8Array(await readFile(path))
            images.push({
              mime: data[0] === 0x89 ? 'image/png' : 'image/jpeg',
              base64: Buffer.from(data).toString('base64'),
            })
          } catch {
            /* Skip unavailable context images. */
          }
        }
        if (images.length < 2) continue
        const prompt = `请根据多张PPT图片回答最后一张图片(slide=${slideIndex})中的题目。前面的图片只作上下文。若上下文不足只返回["上下文不足"]；没有题目返回[]。只输出答案数组，不要解释。`
        answer = await this.analyze(config, images, prompt, requestLabel)
        if (answer.length !== 1 || answer[0] !== insufficientContext) break
      }
    }
    if (
      !answer.length ||
      (answer.length === 1 && answer[0] === insufficientContext)
    )
      return undefined

    const cachePath = join(
      this.root,
      'ai_answers_cache',
      `${safePathComponent(lessonName)}_${safePathComponent(title)}.json`,
    )
    await writeAnswerCache(
      cachePath,
      {
        lesson_name: lessonName,
        presentation_title: title,
        analysis_status: 'partial',
        version: '2.1',
      },
      { [slideIndex]: answer },
      [],
      slides.length ? slides : undefined,
    )
    await this.logger.write(
      'INFO',
      'AI 分析',
      `${title} 第 ${slideIndex} 页现场分析完成`,
    )
    return answer
  }

  private async analyze(
    config: AssistantConfig,
    images: Array<{ mime: string; base64: string }>,
    prompt: string,
    requestLabel: string,
  ) {
    const settings = config.ai_analysis_settings
    const { url, payload } = buildAiRequest(config, images, prompt)
    let lastError: unknown
    const retries = Number(settings.max_retries ?? 3)
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.openai_api_key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(
            Number(settings.request_timeout ?? 30) * 1000,
          ),
        })
        if (!response.ok)
          throw new Error(
            `AI API HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`,
          )
        const type = response.headers.get('content-type')?.toLowerCase() ?? ''
        let text: string
        if (type.includes('text/event-stream')) {
          if (!response.body) throw new Error('AI 流式响应缺少 body')
          text = await consumeSse(
            response.body,
            String(settings.protocol ?? 'responses'),
            this.logger,
          )
        } else {
          const data = (await response.json()) as Record<string, unknown>
          if (
            data.error ||
            ['incomplete', 'failed', 'cancelled'].includes(String(data.status))
          )
            throw new Error('AI 响应未完成')
          text = extractOutput(data)
          const output = Array.isArray(data.output)
            ? (data.output as Record<string, unknown>[])
            : []
          const summary = output
            .filter((item) => item.type === 'reasoning')
            .flatMap((item) =>
              Array.isArray(item.summary)
                ? (item.summary as Record<string, unknown>[])
                : [],
            )
            .map((item) => item.text)
            .filter((item): item is string => typeof item === 'string')
            .join('\n')
          if (summary)
            await this.logger.write('INFO', 'AI 分析', `推理摘要：${summary}`)
        }
        if (attempt > 0)
          await this.logger.write(
            'INFO',
            'AI 分析',
            `${requestLabel} 第 ${attempt}/${retries} 次重试成功`,
          )
        return parseAnswerArray(text)
      } catch (error) {
        lastError = error
        if (attempt < retries) {
          const delay = Math.min(2 ** attempt, 5)
          await this.logger.write(
            'WARNING',
            'AI 分析',
            `${requestLabel} 请求失败：${describeRequestError(error)}；${delay} 秒后自动重试 ${attempt + 1}/${retries}`,
          )
          await new Promise((resolve) => setTimeout(resolve, delay * 1000))
        }
      }
    }
    throw new Error(
      `AI 请求失败（已请求 ${retries + 1} 次，${retries ? `已用尽 ${retries} 次自动重试` : '自动重试已关闭'}）：${describeRequestError(lastError)}`,
      { cause: lastError },
    )
  }
}

function describeRequestError(error: unknown): string {
  if (!(error instanceof Error)) return '未知错误'
  const cause = error.cause as { code?: unknown; message?: unknown } | undefined
  const detail = cause?.code ?? cause?.message
  return detail ? `${error.message}（${String(detail)}）` : error.message
}
