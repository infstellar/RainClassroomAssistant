export function calculateJoinDelay(
  courseStartTime: number,
  config: { type: number; custom: { time: number; cutoff: number } },
  now = Date.now(),
  random = Math.random,
) {
  if (config.type !== 1 || !Number.isFinite(courseStartTime)) return 0
  const elapsed = (now - courseStartTime) / 1000
  if (elapsed > Math.max(0, config.custom.cutoff)) return 0
  const upper = Math.max(10, Math.floor(config.custom.time))
  return 10 + Math.floor(random() * (upper - 10 + 1))
}
