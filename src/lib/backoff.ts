/**
 * Reconnection policy shared by the SSE stream and both WebSocket clients.
 *
 * Exponential backoff with **full jitter**:
 *   delay = random(0, min(cap, base * 2^attempt))
 *
 * Full jitter (not "equal jitter") is what turns an avalanche of 6,400 jurors
 * reconnecting at the same instant into a spread-out ramp. The backend report
 * measures the difference: 530 reconnections per 100 ms (naive) versus 28.
 */
export const BACKOFF_BASE_MS = 3_000;
export const BACKOFF_CAP_MS = 30_000;
export const BACKOFF_MAX_ATTEMPT = 10;

export const fullJitter = (
  attempt: number,
  baseMs = BACKOFF_BASE_MS,
  capMs = BACKOFF_CAP_MS,
): number => {
  const safeAttempt = Math.max(0, Math.min(attempt, BACKOFF_MAX_ATTEMPT));
  const ceiling = Math.min(capMs, baseMs * 2 ** safeAttempt);
  return Math.round(Math.random() * ceiling);
};

export const describeDelay = (delayMs: number): string => {
  if (delayMs < 1000) return `${Math.round(delayMs)} ms`;
  return `${(delayMs / 1000).toFixed(1)} s`;
};
