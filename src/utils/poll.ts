/** Polling ran out of time. Carries the last result seen, so the caller
 *  can still name the run (and its last status) it was waiting on. */
export class PollTimeoutError<T = unknown> extends Error {
  lastResult: T;

  constructor(timeoutMs: number, lastResult: T) {
    super(`Polling timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'PollTimeoutError';
    this.lastResult = lastResult;
  }
}

/**
 * Poll a function until it returns a terminal result or timeout is reached.
 * Uses exponential backoff starting at 1s, maxing at 10s.
 */
export async function pollUntilDone<T>(
  fn: () => Promise<T>,
  isDone: (result: T) => boolean,
  timeoutMs: number = 300_000, // 5 minutes default
): Promise<T> {
  const startTime = Date.now();
  let delay = 1000; // start at 1s
  const maxDelay = 10_000; // cap at 10s

  while (true) {
    const result = await fn();
    if (isDone(result)) return result;

    const elapsed = Date.now() - startTime;
    if (elapsed >= timeoutMs) {
      throw new PollTimeoutError(timeoutMs, result);
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.5, maxDelay);
  }
}
