import { listAiTasks } from './ai-tasks.ts'
import { listAnswerSubmissions } from './answer-submissions.ts'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { QuestionDeck, QuestionEntry } from '../shared/contract'
import {
  alignAnswerCache,
  problemSignature,
  resolveCachedAnswer,
} from './answer-cache.ts'
import { writeManualAnswerCache } from './cache-store.ts'
import {
  safePathComponent,
  slideImagePath,
  type SlideData,
} from './presentation.ts'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

async function json(path: string) {
  try {
    return record(JSON.parse(await readFile(path, 'utf8')))
  } catch {
    return {}
  }
}

async function entries(path: string) {
  return readdir(path, { withFileTypes: true }).catch(() => [])
}

interface DeckRecord extends QuestionDeck {
  modified: number
  imageDirectory: string
  cachePath: string
  slides?: SlideData[]
}

export class QuestionLibrary {
  private readonly root: string
  constructor(root: string) {
    this.root = root
  }

  private async catalog() {
    const decks = new Map<string, DeckRecord>()
    const add = (
      lessonName: string,
      title: string,
      cachePath: string,
      imageDirectory: string,
      modified: number,
      slides?: SlideData[],
    ) => {
      const id = Buffer.from(cachePath).toString('base64url')
      decks.set(id, {
        id,
        lessonName,
        title,
        cachePath,
        imageDirectory,
        modified,
        slides,
      })
    }
    const cacheRoot = join(this.root, 'ai_answers_cache')
    const imageRoot = join(this.root, 'downloads', 'rainclasscache')
    // Older installations have answer caches and images but no presentation manifest.
    for (const file of await entries(cacheRoot)) {
      if (!file.isFile() || !file.name.endsWith('.json')) continue
      const cachePath = join(cacheRoot, file.name)
      const cache = await json(cachePath)
      if (!Object.keys(cache).length) continue
      const metadata = record(cache.metadata)
      const lesson = String(metadata.lesson_name ?? '未知课程')
      const title = String(
        metadata.presentation_title ?? file.name.slice(0, -5),
      )
      add(
        lesson,
        title,
        cachePath,
        join(
          imageRoot,
          safePathComponent(lesson, '未知课程'),
          safePathComponent(title),
        ),
        (await stat(cachePath).catch(() => null))?.mtimeMs ?? 0,
      )
    }
    for (const lesson of await entries(imageRoot)) {
      if (!lesson.isDirectory() || lesson.isSymbolicLink()) continue
      for (const deck of await entries(join(imageRoot, lesson.name))) {
        if (!deck.isDirectory() || deck.isSymbolicLink()) continue
        const directory = join(imageRoot, lesson.name, deck.name)
        const manifest = await json(join(directory, 'presentation.json'))
        if (!Array.isArray(manifest.slides)) continue
        const slides = manifest.slides.filter((value): value is SlideData => {
          const slide = record(value)
          return (
            typeof slide.index === 'string' || typeof slide.index === 'number'
          )
        })
        if (!slides.some((slide) => slide.problem)) continue
        add(
          String(manifest.lessonName ?? lesson.name),
          String(manifest.title ?? deck.name),
          join(cacheRoot, `${lesson.name}_${deck.name}.json`),
          directory,
          (await stat(join(directory, 'presentation.json')).catch(() => null))
            ?.mtimeMs ?? 0,
          slides,
        )
      }
    }
    return decks
  }

  async listDecks(): Promise<QuestionDeck[]> {
    return [...(await this.catalog()).values()]
      .sort(
        (a, b) =>
          b.modified - a.modified ||
          `${a.lessonName}${a.title}`.localeCompare(
            `${b.lessonName}${b.title}`,
            'zh-CN',
          ),
      )
      .map(({ id, lessonName, title }) => ({ id, lessonName, title }))
  }

  private async deck(id: string) {
    const deck = (await this.catalog()).get(id)
    if (!deck) throw new Error('课件不存在，请刷新题库')
    return deck
  }

  async listQuestions(id: string): Promise<QuestionEntry[]> {
    const deck = await this.deck(id)
    let cache = await json(deck.cachePath)
    if (deck.slides) cache = alignAnswerCache(cache, deck.slides)
    const history = (await listAiTasks(this.root)).filter(
      (task) =>
        task.lessonName === deck.lessonName &&
        task.title === deck.title &&
        (!deck.slides ||
          task.signature === JSON.stringify(problemSignature(deck.slides))),
    )
    const metadata = record(cache.metadata)
    const submissions = (await listAnswerSubmissions(this.root)).filter(
      (entry) =>
        entry.lessonName === deck.lessonName && entry.title === deck.title,
    )
    const signature = deck.slides
      ? problemSignature(deck.slides)
      : metadata.problem_signature
    const ai = record(cache.metadata ? cache.answers : cache)
    const manual = record(cache.manual_answers)
    const indexes = deck.slides
      ? deck.slides
          .filter((slide) => slide.problem)
          .map((slide) => String(slide.index))
      : [
          ...new Set([
            ...Object.keys(ai),
            ...Object.keys(manual),
            ...(Array.isArray(metadata.problem_signature)
              ? metadata.problem_signature.map((item) =>
                  String(record(item).index),
                )
              : []),
          ]),
        ]
    return indexes
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((index) => {
        const value = ai[index]
        const needsContext =
          Array.isArray(value) &&
          value.length === 1 &&
          value[0] === '__INSUFFICIENT_CONTEXT__'
        const aiAnswer =
          Array.isArray(value) && value.length && !needsContext ? value : null
        const answer = resolveCachedAnswer(cache, index) ?? null
        const manualAnswer = resolveCachedAnswer(
          { metadata: {}, manual_answers: manual, answers: {} },
          index,
        )
        const slide = deck.slides?.find((item) => String(item.index) === index)
        const problem = record(slide?.problem)
        const text = [problem.content, problem.title, problem.body].find(
          (item) => typeof item === 'string',
        )
        const aiHistory = history.filter((task) => task.slideIndex === index)
        const problemId = Array.isArray(signature)
          ? String(
              record(
                signature.find((item) => String(record(item).index) === index),
              ).id ?? '',
            )
          : ''
        const submission = submissions.find((entry) =>
          problemId
            ? entry.problemId === problemId
            : entry.slideIndex === index,
        )
        return {
          submissionSentAt: submission?.sentAt ?? null,
          submissionStatus: submission?.status ?? null,
          aiHistory,
          index,
          text: typeof text === 'string' ? text : '',
          aiAnswer,
          answer,
          source: answer ? (manualAnswer ? 'manual' : 'ai') : null,
          status: answer
            ? 'answered'
            : needsContext || aiHistory[0]?.error === '上下文不足'
              ? 'context'
              : ['failed', 'interrupted'].includes(
                    aiHistory[0]?.status ?? '',
                  ) ||
                  Object.hasOwn(manual, index) ||
                  metadata.analysis_status === 'failed'
                ? 'failed'
                : 'unanswered',
        }
      })
  }

  async image(id: string, index: string): Promise<string | null> {
    const deck = await this.deck(id)
    if (
      !(await this.listQuestions(id)).some(
        (question) => question.index === index,
      )
    )
      throw new Error('题目不存在')
    try {
      const bytes = await readFile(slideImagePath(deck.imageDirectory, index))
      const mime =
        bytes[0] === 0x89 && bytes[1] === 0x50
          ? 'image/png'
          : bytes[0] === 0xff && bytes[1] === 0xd8
            ? 'image/jpeg'
            : null
      return mime ? `data:${mime};base64,${bytes.toString('base64')}` : null
    } catch {
      return null
    }
  }

  async saveManualAnswer(id: string, index: string, answer: string) {
    const deck = await this.deck(id)
    if (
      !(await this.listQuestions(id)).some(
        (question) => question.index === index,
      )
    )
      throw new Error('题目不存在')
    const value = answer.trim()
    await writeManualAnswerCache(
      deck.cachePath,
      index,
      value || null,
      deck.slides,
    )
    return this.listQuestions(id)
  }
}
