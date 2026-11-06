export class DanmuFollower {
  private readonly received = new Map<string, number[]>()
  private readonly sent = new Map<string, number>()

  shouldSend(content: string, limit: number, now = Date.now()) {
    const key = content.trim().toLocaleLowerCase()
    if (!key || !Number.isFinite(limit) || limit < 1) return false
    const lastSent = this.sent.get(key)
    if (lastSent !== undefined && now - lastSent <= 60_000) return false

    const recent = (this.received.get(key) ?? []).filter(
      (timestamp) => now - timestamp <= 60_000,
    )
    if (recent.length + 1 < limit) {
      recent.push(now)
      this.received.set(key, recent)
      return false
    }

    this.received.set(key, [])
    this.sent.set(key, now)
    return true
  }
}
