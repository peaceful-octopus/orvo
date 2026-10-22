/** Full-jitter exponential backoff: a random delay up to `min(cap, base * 2^attempt)`, so reconnect storms spread out. */
export function backoffDelay(attempt: number, random: () => number = Math.random, baseMs = 500, capMs = 30_000): number {
  return random() * Math.min(capMs, baseMs * 2 ** attempt);
}
