import type { SlideData } from './presentation.ts'

export function collectProblemDisplayIndexes(
  events: unknown,
  indexes: Map<string, string | number>,
) {
  if (!Array.isArray(events)) return
  for (const value of events) {
    if (!value || typeof value !== 'object') continue
    const event = value as Record<string, unknown>
    if (event.type !== 'problem' || event.si === undefined || event.si === null)
      continue
    for (const id of [event.prob, event.sid]) {
      if (id !== undefined && id !== null && id !== '')
        indexes.set(String(id), event.si as string | number)
    }
  }
}

export function normalizePresentationSlides<T extends SlideData>(
  slides: T[],
  indexes: Map<string, string | number>,
) {
  const byIndex = new Map<string, T>()
  for (const slide of slides) {
    const problem = slide.problem
    const ids = [
      problem?.problemId,
      problem?.id,
      problem?.sid,
      (slide as Record<string, unknown>).id,
      (slide as Record<string, unknown>).slideId,
    ]
      .filter((id) => id !== undefined && id !== null && id !== '')
      .map(String)
    const displayIndex = problem
      ? ids.map((id) => indexes.get(id)).find((index) => index !== undefined)
      : undefined
    const normalized =
      displayIndex === undefined ? slide : { ...slide, index: displayIndex }
    const key = String(normalized.index)
    const existing = byIndex.get(key)
    if (!existing || (!existing.problem && normalized.problem))
      byIndex.set(key, normalized)
  }
  return [...byIndex.values()].sort((a, b) =>
    String(a.index).localeCompare(String(b.index), 'en', { numeric: true }),
  )
}
