import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { handleError, MonidError, rateLimitedMessage } from '../../src/utils/error.js';

describe('rate-limit messages', () => {
  it('names what was limited and the wait', () => {
    const err = new MonidError('RATE_LIMITED', 'Rate limited. Retry after 37s.', 429, {
      retryAfterSec: 37,
      limitedOn: 'tinyfish /search',
    });
    expect(rateLimitedMessage(err)).toBe('Rate limited on tinyfish /search. Retry after 37s.');
  });

  it('falls back gracefully without a wait or label', () => {
    const err = new MonidError('RATE_LIMITED', 'x', 429);
    expect(rateLimitedMessage(err)).toBe('Rate limited. Please try again later.');
  });
});

describe('handleError', () => {
  const real = { exit: process.exit, log: console.log, error: console.error };
  let out: string[];
  let errOut: string[];
  let exitCode: number | undefined;

  beforeEach(() => {
    out = [];
    errOut = [];
    exitCode = undefined;
    console.log = (s: string) => void out.push(s);
    console.error = (s: string) => void errOut.push(s);
    process.exit = ((c?: number) => {
      exitCode = c;
      throw new Error('__exit__');
    }) as typeof process.exit;
  });

  afterEach(() => {
    process.exit = real.exit;
    console.log = real.log;
    console.error = real.error;
  });

  function run(err: unknown, json: boolean) {
    try {
      handleError(err, json);
    } catch (e) {
      if ((e as Error).message !== '__exit__') throw e;
    }
  }

  it('a Monid 429 keeps the {error:{code,message}} shape and exit 1, with the new text', () => {
    run(new MonidError('RATE_LIMITED', 'Rate limited. Retry after 37s.', 429, {
      retryAfterSec: 37,
      limitedOn: 'discover',
    }), true);
    expect(JSON.parse(out.join('\n'))).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Rate limited on discover. Retry after 37s.' },
    });
    expect(exitCode).toBe(1);
  });

  it('a Monid 429 in text mode uses the usual error prefix', () => {
    run(new MonidError('RATE_LIMITED', 'x', 429, { retryAfterSec: 5, limitedOn: 'inspect' }), false);
    expect(errOut[0]).toContain('monid: error:');
    expect(errOut[0]).toContain('Rate limited on inspect. Retry after 5s.');
    expect(exitCode).toBe(1);
  });

  it('a Monid 401 still shows the expired-key message and the keys hint', () => {
    run(new MonidError('AUTH_FAILED', 'Unauthorized', 401), false);
    expect(errOut[0]).toContain('API key is expired or invalid');
    expect(errOut.join('\n')).toContain('monid keys add');
  });

  it('a provider 401 is not shown as a Monid key problem', () => {
    run(new MonidError('AUTH_FAILED', 'HTTP 401', 401, {
      limitedOn: 'tinyfish /search',
      providerRun: { runId: '01RUN', httpStatus: 401 },
    }), false);
    const all = errOut.join('\n');
    expect(all).toContain('tinyfish /search: the provider returned HTTP 401 (run 01RUN)');
    expect(all).not.toContain('API key is expired');
    expect(all).not.toContain('monid keys add');
    expect(exitCode).toBe(1);
  });

  it('a provider 429 is not shown as a Monid rate limit; --json code unchanged', () => {
    run(new MonidError('RATE_LIMITED', 'HTTP 429', 429, {
      limitedOn: 'tinyfish /search',
      providerRun: { runId: '01RUN', httpStatus: 429 },
    }), true);
    const parsed = JSON.parse(out.join('\n'));
    expect(parsed.error.code).toBe('RATE_LIMITED');
    expect(parsed.error.message).not.toContain('Rate limited on');
    expect(parsed.error.message).toContain('the provider returned HTTP 429');
  });
});
