import type { SlideData } from './presentation.ts'
import { validateAnswerFormat } from './answers.ts'

export function problemSignature(slides: SlideData[]) {
  return slides
    .filter((slide) => slide.problem)
    .map((slide) => {
      const problem = slide.problem!
      const ids = [
        problem.problemId,
        problem.id,
        problem.sid,
        (slide as unknown as Record<string, unknown>).id,
        (slide as unknown as Record<string, unknown>).slideId,
      ]
      return {
        index: String(slide.index),
        id: String(
          ids.find((id) => id !== undefined && id !== null && id !== '') ?? '',
        ),
      }
    })
}

export function cacheMatchesSlides(cache: unknown, slides: SlideData[]) {
  const signature = asRecord(asRecord(cache)?.metadata)?.problem_signature
  return (
    signature === undefined ||
    JSON.stringify(signature) === JSON.stringify(problemSignature(slides))
  )
}

// Page numbers from unlockproblem can differ from presentation/fetch. Re-key
// each answer by problem identity instead of invalidating the entire deck.
export function alignAnswerCache(cache: unknown, slides: SlideData[]) {
  const data = asRecord(cache) ?? {}
  const metadata = asRecord(data.metadata)
  const signature = metadata?.problem_signature
  if (!Array.isArray(signature)) return data
  const old = signature.map((item) => asRecord(item) ?? {})
  const current = problemSignature(slides)
  const mapping = new Map<string, string>()
  for (const problem of current) {
    const matches = old.filter((item) =>
      problem.id
        ? item.id === problem.id
        : !item.id && String(item.index) === problem.index,
    )
    if (matches.length === 1)
      mapping.set(String(matches[0].index), problem.index)
  }
  const result: Record<string, unknown> = {
    ...data,
    metadata: { ...metadata, problem_signature: current },
  }
  for (const field of ['answers', 'manual_answers', 'manual_answer_times']) {
    const values = asRecord(data[field]) ?? {}
    result[field] = Object.fromEntries(
      [...mapping]
        .filter(([index]) => Object.hasOwn(values, index))
        .map(([from, to]) => [to, values[from]]),
    )
  }
  return result
}

export function resolveCachedAnswer(
  cache: unknown,
  slideIndex: string,
  slides?: SlideData[],
): unknown[] | undefined {
  if (!cache || typeof cache !== 'object' || Array.isArray(cache))
    return undefined
  const data = slides
    ? alignAnswerCache(cache, slides)
    : (cache as Record<string, unknown>)
  const answers = data.metadata ? data.answers : data
  const manual = data.metadata ? data.manual_answers : undefined
  const manualValue = asRecord(manual)?.[slideIndex]
  if (Array.isArray(manualValue) && manualValue.length > 0) return manualValue
  const suggested = asRecord(manualValue)?.suggested_answers
  if (
    Array.isArray(suggested) &&
    suggested.length > 0 &&
    JSON.stringify(suggested) !== '["请在此处填写建议答案"]'
  )
    return suggested
  const aiValue = asRecord(answers)?.[slideIndex]
  if (!Array.isArray(aiValue) || aiValue.length === 0) return undefined
  if (aiValue.length === 1 && aiValue[0] === '__INSUFFICIENT_CONTEXT__')
    return undefined
  try {
    const problem = slides?.find(
      (slide) => String(slide.index) === slideIndex,
    )?.problem
    validateAnswerFormat(Number(problem?.problemType), aiValue)
  } catch {
    return undefined
  }
  return aiValue
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
