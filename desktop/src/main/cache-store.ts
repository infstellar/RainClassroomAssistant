import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  alignAnswerCache,
  cacheMatchesSlides,
  problemSignature,
} from './answer-cache.ts'
import type { SlideData } from './presentation.ts'

const pending = new Map<string, Promise<void>>()

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function writeAnswerCache(
  path: string,
  metadata: Record<string, unknown>,
  answers: Record<string, unknown>,
  failedIndexes: string[],
  slides?: SlideData[],
) {
  const previous = pending.get(path) ?? Promise.resolve()
  const task = previous
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(path), { recursive: true })
      let existing: Record<string, unknown> = {}
      try {
        const content = await readFile(path, 'utf8')
        try {
          existing = record(JSON.parse(content))
        } catch {
          await writeFile(`${path}.invalid-${Date.now()}`, content, 'utf8')
        }
        if (slides && !cacheMatchesSlides(existing, slides)) {
          await writeFile(`${path}.previous-${Date.now()}`, content, 'utf8')
          existing = alignAnswerCache(existing, slides)
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      const manual = record(existing.manual_answers)
      for (const index of failedIndexes)
        if (!(index in manual)) manual[index] = []
      const merged = {
        ...existing,
        metadata: {
          ...record(existing.metadata),
          ...metadata,
          ...(slides ? { problem_signature: problemSignature(slides) } : {}),
        },
        answers: {
          ...record(existing.metadata ? existing.answers : existing),
          ...answers,
        },
        manual_answers: manual,
      }
      const temporary = `${path}.${randomUUID()}.tmp`
      await writeFile(temporary, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
      await rename(temporary, path)
    })
  pending.set(path, task)
  void task
    .finally(() => {
      if (pending.get(path) === task) pending.delete(path)
    })
    .catch(() => undefined)
  return task
}

export function writeManualAnswerCache(
  path: string,
  index: string,
  answer: string | null,
  slides?: SlideData[],
) {
  const previous = pending.get(path) ?? Promise.resolve()
  const task = previous
    .catch(() => undefined)
    .then(async () => {
      let existing: Record<string, unknown> = {}
      try {
        existing = record(JSON.parse(await readFile(path, 'utf8')))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (slides) existing = alignAnswerCache(existing, slides)
      const manual = record(existing.manual_answers)
      const times = record(existing.manual_answer_times)
      if (answer === null) delete times[index]
      else times[index] = new Date().toISOString()
      if (answer === null) delete manual[index]
      else manual[index] = [answer]
      const merged = {
        ...existing,
        manual_answer_times: times,
        metadata: record(existing.metadata),
        answers: record(existing.metadata ? existing.answers : existing),
        manual_answers: manual,
      }
      await mkdir(dirname(path), { recursive: true })
      const temporary = `${path}.${randomUUID()}.tmp`
      await writeFile(temporary, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
      await rename(temporary, path)
    })
  pending.set(path, task)
  void task
    .finally(() => {
      if (pending.get(path) === task) pending.delete(path)
    })
    .catch(() => undefined)
  return task
}
