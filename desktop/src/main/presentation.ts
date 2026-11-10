import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import type { AppLogger } from './logger'

export interface SlideData {
  index: string | number
  cover?: string
  problem?: Record<string, unknown>
}

export function safePathComponent(value: string, fallback = '未知演示文稿') {
  let name = value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .trim()
    .replace(/[ .]+$/g, '')
  if (!name) name = fallback
  if (/^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(name))
    name = `_${name}`
  return name
}

export function slideImagePath(directory: string, index: string | number) {
  return join(directory, `${safePathComponent(String(index), 'slide')}.jpg`)
}

function contentType(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg'
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return 'png'
  throw new Error('下载内容不是有效的 JPEG 或 PNG 图片')
}

async function fetchImage(url: string, fetcher: typeof fetch) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:')
    throw new Error('课件图片 URL 必须使用 HTTPS')
  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetcher(parsed, {
        signal: AbortSignal.timeout(30000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const contentLength = Number(response.headers.get('content-length'))
      if (contentLength > 30 * 1024 * 1024) throw new Error('图片数据大小无效')
      if (!response.body) throw new Error('图片响应缺少数据')
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.length
          if (size > 30 * 1024 * 1024) {
            await reader.cancel()
            throw new Error('图片数据大小无效')
          }
          chunks.push(value)
        }
      } finally {
        reader.releaseLock()
      }
      if (size < 10) throw new Error('图片数据过小')
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.length
      }
      contentType(bytes)
      return bytes
    } catch (error) {
      lastError = error
      if (attempt < 4)
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('图片下载失败')
}

export async function downloadSlideImage(
  url: string,
  path: string,
  fetcher: typeof fetch = fetch,
) {
  const bytes = await fetchImage(url, fetcher)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, bytes)
  return bytes
}

export async function downloadPresentation(options: {
  slides: SlideData[]
  title: string
  lessonName: string
  dimensions: { width: number; height: number }
  root?: string
  forceRefresh?: boolean
  fetcher?: typeof fetch
  logger: AppLogger
}) {
  const { slides, title, lessonName, dimensions, logger } = options
  const root = options.root ?? process.cwd()
  const fetcher = options.fetcher ?? fetch
  const safeLesson = safePathComponent(lessonName, '未知课程')
  const safeTitle = safePathComponent(title)
  const imageDirectory = join(
    root,
    'downloads',
    'rainclasscache',
    safeLesson,
    safeTitle,
  )
  const outputDirectory = join(root, 'downloads', safeLesson)
  await Promise.all([
    mkdir(imageDirectory, { recursive: true }),
    mkdir(outputDirectory, { recursive: true }),
  ])
  const manifestPath = join(imageDirectory, 'presentation.json')
  const temporaryManifest = `${manifestPath}.${randomUUID()}.tmp`
  await writeFile(
    temporaryManifest,
    JSON.stringify({ lessonName, title, slides }),
  )
  await rename(temporaryManifest, manifestPath)
  const semaphore = new Semaphore(8)
  const loaded = await Promise.all(
    slides.map((slide) =>
      semaphore.run(async () => {
        const imagePath = slideImagePath(imageDirectory, slide.index)
        let bytes: Uint8Array
        try {
          if (options.forceRefresh) throw new Error('强制刷新课件图片')
          bytes = new Uint8Array(await readFile(imagePath))
          contentType(bytes)
        } catch {
          if (!slide.cover)
            throw new Error(`幻灯片 ${slide.index} 缺少图片地址`)
          bytes = await fetchImage(slide.cover, fetcher)
          await writeFile(imagePath, bytes)
          await logger.write(
            'INFO',
            '课件下载',
            `${safeTitle}：幻灯片 ${slide.index} 已下载`,
          )
        }
        return { slide, bytes }
      }),
    ),
  )
  const digest = createHash('sha256')
  for (const { bytes } of loaded) digest.update(bytes)
  const hash = digest.digest('hex')
  const pdfPath = join(outputDirectory, `${safeTitle}.pdf`)
  const pdf = await PDFDocument.create()
  pdf.setAuthor('RainClassroom')
  pdf.setKeywords([hash])
  for (const { bytes } of loaded) {
    const type = contentType(bytes)
    const image =
      type === 'jpeg' ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes)
    const page = pdf.addPage([dimensions.width, dimensions.height])
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: dimensions.width,
      height: dimensions.height,
    })
  }
  await writeFile(pdfPath, await pdf.save())
  await logger.write(
    'INFO',
    '课件下载',
    `${safeTitle}：PDF 已生成，共 ${loaded.length} 页`,
  )
  return { pdfPath, imageDirectory, slideCount: loaded.length }
}

class Semaphore {
  private active = 0
  private waiting: Array<() => void> = []
  private readonly limit: number
  constructor(limit: number) {
    this.limit = limit
  }
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit)
      await new Promise<void>((resolve) => this.waiting.push(resolve))
    this.active += 1
    try {
      return await task()
    } finally {
      this.active -= 1
      this.waiting.shift()?.()
    }
  }
}
