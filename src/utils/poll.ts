import { isRateLimited } from './error.js';

/**
 * Poll a function until it returns a terminal result or timeout is reached.
 * Uses exponential backoff starting at 1s, maxing at 10s.
 *
 * A rate-limited poll (HTTP 429, `RATE_LIMITED`) does NOT end the wait: the
 * run keeps going server-side, so we sleep the server's `Retry-After`
 * (capped by the time left) and poll again. `onRateLimited` lets the caller
 * show it (e.g. update a spinner).
 */
export async function pollUntilDone<T>(
  fn: () => Promise<T>,
  isDone: (result: T) => boolean,
  timeoutMs: number = 300_000, // 5 minutes default
  onRateLimited?: (retryAfterSec: number) => void,
): Promise<T> {
  const startTime = Date.now();
  let delay = 1000; // start at 1s
  const maxDelay = 10_000; // cap at 10s

  const timedOut = () =>
    new Error(`Polling timed out after ${Math.round(timeoutMs / 1000)}s`);

  while (true) {
    let result: T;
    try {
      result = await fn();
    } catch (err) {
      if (!isRateLimited(err)) throw err;
      const left = timeoutMs - (Date.now() - startTime);
      if (left <= 0) throw err;
      const waitSec = Math.max(1, err.retryAfterSec ?? Math.ceil(delay / 1000));
      onRateLimited?.(waitSec);
      await new Promise((resolve) => setTimeout(resolve, Math.min(waitSec * 1000, left)));
      if (Date.now() - startTime >= timeoutMs) throw timedOut();
      continue;
    }
    if (isDone(result)) return result;

    const elapsed = Date.now() - startTime;
    if (elapsed >= timeoutMs) {
      throw timedOut();
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.5, maxDelay);
  }
}
