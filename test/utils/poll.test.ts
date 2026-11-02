import { describe, it, expect } from 'bun:test';
import { pollUntilDone, PollTimeoutError } from '../../src/utils/poll.js';

describe('pollUntilDone', () => {
  it('returns immediately if first result is done', async () => {
    let calls = 0;
    const result = await pollUntilDone(
      async () => {
        calls++;
        return { status: 'COMPLETED', value: 42 };
      },
      (r) => r.status === 'COMPLETED',
    );

    expect(calls).toBe(1);
    expect(result.value).toBe(42);
  });

  it('polls until done condition is met', async () => {
    let calls = 0;
    const result = await pollUntilDone(
      async () => {
        calls++;
        return {
          status: calls >= 3 ? 'COMPLETED' : 'RUNNING',
          value: calls,
        };
      },
      (r) => r.status === 'COMPLETED',
      30_000,
    );

    expect(calls).toBe(3);
    expect(result.value).toBe(3);
  });

  it('throws on timeout', async () => {
    const fn = async () => ({ status: 'RUNNING' });
    await expect(
      pollUntilDone(fn, (r) => r.status === 'COMPLETED', 100),
    ).rejects.toThrow('Polling timed out');
  });

  it('timeout error carries the last result seen', async () => {
    const err = await pollUntilDone(
      async () => ({ status: 'RUNNING' }),
      (r) => r.status === 'COMPLETED',
      100,
    ).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(PollTimeoutError);
    expect((err as PollTimeoutError<{ status: string }>).lastResult.status).toBe('RUNNING');
    expect((err as Error).message).toBe('Polling timed out after 0s');
  });
});
