import type { SlideData } from './presentation.ts'

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

export function resolveCachedAnswer(
  cache: unknown,
  slideIndex: string,
  slides?: SlideData[],
): unknown[] | undefined {
  if (!cache || typeof cache !== 'object' || Array.isArray(cache))
    return undefined
  if (slides && !cacheMatchesSlides(cache, slides)) return undefined
  const data = cache as Record<string, unknown>
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
  return aiValue
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
