export function isNetworkFailure(error: unknown) {
  if (error instanceof TypeError) return true
  if (!(error instanceof Error)) return false
  if (['AbortError', 'TimeoutError'].includes(error.name)) return true
  const code = (error as NodeJS.ErrnoException).code ?? ''
  return /^(ECONN|EHOST|ENET|EPIPE|ETIMEDOUT|ENOTFOUND)/.test(code)
}
