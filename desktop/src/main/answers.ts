export type AnswerValue = unknown

export function hasUsableAnswer(answer: AnswerValue) {
  if (Array.isArray(answer))
    return (
      answer.length > 0 &&
      answer.some(
        (item) =>
          item !== null && item !== undefined && String(item).trim() !== '',
      )
    )
  if (answer === null || answer === undefined) return false
  return typeof answer !== 'string' || answer.trim().length > 0
}

export function remainingAnswerTime(
  event: Record<string, unknown>,
  receivedAt = Date.now(),
  now = Date.now(),
) {
  const limit = Number(event.limit ?? -1)
  if (limit === -1) return -1
  if (!Number.isFinite(limit)) return 0
  const serverNow = Number(event.now)
  const sentAt = Number(event.dt)
  const elapsed =
    Number.isFinite(serverNow) && Number.isFinite(sentAt)
      ? Math.max(0, serverNow - sentAt) / 1000
      : Math.max(
          0,
          now / 1000 - (Number.isFinite(sentAt) ? sentAt / 1000 : now / 1000),
        )
  return Math.floor(limit - elapsed - Math.max(0, now - receivedAt) / 1000)
}

export function submissionCandidates(
  problemType: number,
  answer: AnswerValue,
): unknown[] {
  if (problemType === 1 || problemType === 2) {
    const choices = Array.isArray(answer) ? answer : [answer]
    const normalized = choices.map((value) => {
      if (typeof value !== 'number' && typeof value !== 'string')
        throw new Error(`无效选择题选项：${String(value)}`)
      let choice = String(value)
        .trim()
        .replace(/^['"]|['"]$/g, '')
        .toUpperCase()
      if (/^[0-9]+$/.test(choice)) {
        const index = Number(choice)
        if (index < 1 || index > 26)
          throw new Error(`选择题选项序号应在1到26之间：${choice}`)
        choice = String.fromCharCode(64 + index)
      }
      if (!/^[A-Z]$/.test(choice)) throw new Error(`无效选择题选项：${choice}`)
      return choice
    })
    return [[normalized]]
  }
  if (problemType === 5) {
    const content = (Array.isArray(answer) ? answer : [answer])
      .map((value) => String(value).replaceAll('"', ''))
      .join('\n')
    return [{ content, pics: [{ pic: '', thumb: '' }] }]
  }
  if (problemType === 4 && Array.isArray(answer)) {
    return [
      answer,
      Object.fromEntries(answer.map((value, index) => [String(index), value])),
    ]
  }
  return [answer]
}

export function shouldRetrySubmission(
  problemType: number,
  responseText: string,
  parseError: string,
) {
  if (problemType !== 4) return false
  const content = `${responseText} ${parseError}`.toLowerCase()
  return [
    'cannot be cast',
    'jsonarray',
    'jsonobject',
    'linkedhashmap',
    'arraylist',
  ].some((marker) => content.includes(marker))
}

export function calculateAnswerDelay(
  limit: number,
  type: number,
  customPercent = 50,
  random = Math.random,
) {
  const boundedLimit = limit === -1 ? 60 : limit
  const defaultLambda =
    boundedLimit <= 30
      ? boundedLimit / 3
      : boundedLimit >= 90
        ? boundedLimit / 2 - 30
        : boundedLimit / 5
  const poisson = (lambda: number) => {
    const threshold = Math.exp(-lambda)
    let product = 1
    let sample = 0
    while (product > threshold) {
      product *= Math.max(Number.EPSILON, random())
      sample += 1
    }
    return Math.min(sample, lambda * 1.4)
  }
  const lambda =
    type === 2
      ? (boundedLimit * 35 * 0.9) / 150
      : type === 3
        ? (boundedLimit * 85 * 0.9) / 150
        : type === 4
          ? (boundedLimit * customPercent * 0.9) / 150
          : defaultLambda
  let wait = Math.floor(
    type === 3 ? boundedLimit * 0.6 + poisson(lambda) * 0.4 : poisson(lambda),
  )
  if (wait > boundedLimit) wait = boundedLimit - 25
  return wait
}
