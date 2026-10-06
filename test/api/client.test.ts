import { afterEach, describe, expect, it } from 'bun:test';
import { MonidAPI } from '../../src/api/client.js';
import { MonidError } from '../../src/utils/error.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(status: number, body: string, headers: Record<string, string> = {}) {
  globalThis.fetch = (async () =>
    new Response(body, { status, headers })) as unknown as typeof fetch;
}

async function caught(p: Promise<unknown>): Promise<MonidError> {
  try {
    await p;
  } catch (e) {
    return e as MonidError;
  }
  throw new Error('expected a rejection');
}

const api = new MonidAPI({ baseUrl: 'https://api.test', apiKey: 'monid_test_x' });

describe('MonidAPI error parsing', () => {
  it('parses our RATE_LIMITED 429: Retry-After and the run label', async () => {
    stubFetch(
      429,
      JSON.stringify({ code: 429, message: 'Rate limited. Retry after 37s.', errorCode: 'RATE_LIMITED' }),
      { 'Retry-After': '37', 'RateLimit-Limit': '60', 'RateLimit-Remaining': '0', 'RateLimit-Reset': '37' },
    );
    const err = await caught(api.run('tinyfish', '/search'));
    expect(err).toBeInstanceOf(MonidError);
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.statusCode).toBe(429);
    expect(err.retryAfterSec).toBe(37);
    expect(err.limitedOn).toBe('tinyfish /search');
    expect(err.providerRun).toBeUndefined();
  });

  it('labels discover / inspect by command, other calls by route', async () => {
    stubFetch(429, '{"code":429,"message":"Rate limited. Retry after 5s.","errorCode":"RATE_LIMITED"}', { 'Retry-After': '5' });
    expect((await caught(api.discover('x'))).limitedOn).toBe('discover');
    expect((await caught(api.inspect('exa', '/search'))).limitedOn).toBe('inspect');
    expect((await caught(api.getRun('01ABC'))).limitedOn).toBe('GET /v1/runs/01ABC');
  });

  it('a non-JSON error body (edge firewall) does not crash parsing and is not echoed', async () => {
    stubFetch(429, '<html>Too many requests</html>', { 'Retry-After': '10' });
    const err = await caught(api.discover('x'));
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.message).toBe('HTTP 429');
    expect(err.retryAfterSec).toBe(10);
  });

  it('other errors keep their status-derived code', async () => {
    stubFetch(404, '{"code":404,"message":"Run x not found"}');
    const err = await caught(api.getRun('x'));
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('Run x not found');
    expect(err.retryAfterSec).toBeUndefined();
  });

  it('a body errorCode does not replace the status-derived code (same as main)', async () => {
    stubFetch(402, '{"code":402,"message":"Insufficient funds","errorCode":"WALLET_INSUFFICIENT_FUNDS"}');
    expect((await caught(api.run('tinyfish', '/search'))).code).toBe('INSUFFICIENT_BALANCE');
    stubFetch(403, '{"code":403,"message":"Missing scope","errorCode":"INSUFFICIENT_SCOPE"}');
    expect((await caught(api.discover('x'))).code).toBe('FORBIDDEN');
  });

  it('a COMPLETED run body on a non-2xx marks the status as the provider\'s', async () => {
    stubFetch(429, JSON.stringify({ runId: '01RUN', status: 'COMPLETED', providerResponse: { httpStatus: 429 } }));
    const err = await caught(api.run('tinyfish', '/search'));
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.providerRun).toEqual({ runId: '01RUN', httpStatus: 429 });
  });

  it('a provider 402 surfaced as 502 reports the provider\'s own status', async () => {
    stubFetch(502, JSON.stringify({ runId: '01RUN', status: 'COMPLETED', providerResponse: { httpStatus: 402 } }));
    expect((await caught(api.run('tinyfish', '/search'))).providerRun).toEqual({ runId: '01RUN', httpStatus: 402 });
  });

  it('a TIMED_OUT 408 run body is not treated as a provider status', async () => {
    stubFetch(408, JSON.stringify({ runId: '01RUN', status: 'TIMED_OUT' }));
    const err = await caught(api.run('tinyfish', '/search'));
    expect(err.providerRun).toBeUndefined();
    expect(err.message).toBe('HTTP 408');
  });
});
