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
      throw new Error(
        `Polling timed out after ${Math.round(timeoutMs / 1000)}s`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.5, maxDelay);
  }
}
