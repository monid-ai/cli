import { afterEach, describe, expect, it } from 'bun:test';
import { MonidAPI } from '../../src/api/client.js';
import { MonidError } from '../../src/utils/error.js';
import { VERSION } from '../../src/config/constants.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answer the next request with this exact status, body and headers. */
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

const api = new MonidAPI({ baseUrl: 'https://api.example.test', apiKey: 'monid_test_x' });

/** The bare `<html>` + CRLF error page a gateway returns — not the API. */
const GATEWAY_HTML = '<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>...</body>\r\n</html>';

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

  it('a Monid 401 envelope (bad key) is not a provider run', async () => {
    stubFetch(401, '{"code":401,"message":"Invalid API key"}');
    const err = await caught(api.run('tinyfish', '/search'));
    expect(err.code).toBe('AUTH_FAILED');
    expect(err.message).toBe('Invalid API key');
    expect(err.providerRun).toBeUndefined();
  });

  it('a COMPLETED run body on a non-2xx marks the status as the provider\'s', async () => {
    stubFetch(401, JSON.stringify({ runId: '01RUN', status: 'COMPLETED', providerResponse: { httpStatus: 401 } }));
    const err = await caught(api.run('tinyfish', '/search'));
    expect(err.providerRun).toEqual({ runId: '01RUN', status: 'COMPLETED', httpStatus: 401 });
  });

  it('a provider 402 surfaced as 502 reports the provider\'s own status', async () => {
    stubFetch(502, JSON.stringify({ runId: '01RUN', status: 'COMPLETED', providerResponse: { httpStatus: 402 } }));
    expect((await caught(api.run('tinyfish', '/search'))).providerRun).toEqual({
      runId: '01RUN',
      status: 'COMPLETED',
      httpStatus: 402,
    });
  });

  it('a TIMED_OUT 408 run body keeps the run id', async () => {
    stubFetch(408, JSON.stringify({ runId: '01RUN', status: 'TIMED_OUT' }));
    const err = await caught(api.run('tinyfish', '/search'));
    expect(err.providerRun).toEqual({ runId: '01RUN', status: 'TIMED_OUT', httpStatus: 408 });
  });

  it('a run body in another status is not treated as a provider run', async () => {
    stubFetch(500, JSON.stringify({ runId: '01RUN', status: 'FAILED' }));
    expect((await caught(api.run('tinyfish', '/search'))).providerRun).toBeUndefined();
  });
});

describe('MonidAPI non-JSON responses', () => {
  it('reports the HTTP status when a gateway answers 5xx with HTML', async () => {
    // Regression: the body was parsed BEFORE the status was checked, so this
    // surfaced as `Unexpected token '<', "<html>..." is not valid JSON` and
    // the 502 was lost entirely.
    stubFetch(502, GATEWAY_HTML, { 'content-type': 'text/html' });

    const err = await caught(api.whoami());
    expect(err).toBeInstanceOf(MonidError);
    expect(err.statusCode).toBe(502);
    expect(err.code).toBe('HTTP_502');
    expect(err.message).toBe('HTTP 502');
    expect(err.message).not.toContain('Unexpected token');
  });

  it('keeps the mapped code for a non-JSON 401', async () => {
    stubFetch(401, GATEWAY_HTML, { 'content-type': 'text/html' });

    const err = await caught(api.whoami());
    expect(err.code).toBe('AUTH_FAILED');
    expect(err.statusCode).toBe(401);
  });

  it('still prefers a structured API error message over the status', async () => {
    stubFetch(
      402,
      JSON.stringify({ error: { code: 'INSUFFICIENT_BALANCE', message: 'Balance too low' } }),
      { 'content-type': 'application/json' },
    );

    const err = await caught(api.whoami());
    expect(err.code).toBe('INSUFFICIENT_BALANCE');
    expect(err.message).toBe('Balance too low');
  });

  it('names a 2xx that is not JSON instead of throwing a parse error', async () => {
    stubFetch(200, '<html>\r\n<body>captive portal</body>\r\n</html>', { 'content-type': 'text/html' });

    const err = await caught(api.whoami());
    expect(err).toBeInstanceOf(MonidError);
    expect(err.code).toBe('INVALID_RESPONSE');
    expect(err.message).toContain('Expected JSON');
    expect(err.message).toContain('text/html');
    expect(err.message).not.toContain('Unexpected token');
  });

  it('describes an empty 2xx body rather than reporting a parse error', async () => {
    stubFetch(200, '', { 'content-type': 'application/json' });

    const err = await caught(api.whoami());
    expect(err.code).toBe('INVALID_RESPONSE');
    expect(err.message).toContain('empty');
  });

  it('truncates a long non-JSON body in the error message', async () => {
    stubFetch(200, 'x'.repeat(5000), { 'content-type': 'text/plain' });

    const err = await caught(api.whoami());
    expect(err.message).toContain('…');
    expect(err.message.length).toBeLessThan(200);
  });

  it('returns the parsed payload on a normal 200', async () => {
    stubFetch(200, JSON.stringify({ workspace: 'Test Workspace' }), { 'content-type': 'application/json' });

    const out = await api.whoami() as unknown as { workspace: string };
    expect(out.workspace).toBe('Test Workspace');
  });
});

describe('MonidAPI request headers', () => {
  it('identifies itself as cli@<version>', async () => {
    let sent: Headers | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sent = new Headers(init?.headers);
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    await api.whoami();
    expect(sent?.get('X-Monid-Client')).toBe(`cli@${VERSION}`);
  });
});

describe('MonidAPI sendFeedback', () => {
  function captureRequest(response: unknown, status = 201) {
    const sent: { url?: string; method?: string; body?: unknown } = {};
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      sent.url = url;
      sent.method = init?.method;
      sent.body = init?.body ? JSON.parse(String(init.body)) : undefined;
      return new Response(JSON.stringify(response), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    return sent;
  }

  it('POSTs the text to /v1/feedback and returns the stored id', async () => {
    const sent = captureRequest({ feedbackId: 'fb-1', createdAt: '2026-10-20T00:00:00.000Z' });

    const out = await api.sendFeedback('great results');
    expect(sent.method).toBe('POST');
    expect(sent.url).toBe('https://api.example.test/v1/feedback');
    expect(sent.body).toEqual({ text: 'great results' });
    expect(out.feedbackId).toBe('fb-1');
  });

  it('includes runId only when given', async () => {
    const sent = captureRequest({ feedbackId: 'fb-2', createdAt: '2026-10-20T00:00:00.000Z' });

    await api.sendFeedback('stale posts', '01JGXYZABCDEFGHJKMNPQRSTVW');
    expect(sent.body).toEqual({ text: 'stale posts', runId: '01JGXYZABCDEFGHJKMNPQRSTVW' });
  });

  it('surfaces a 404 for an unknown run as NOT_FOUND', async () => {
    captureRequest({ code: 404, message: 'Run 01X not found' }, 404);

    const err = await api.sendFeedback('x', '01X').then(() => null, (e: unknown) => e);
    expect((err as MonidError).statusCode).toBe(404);
    expect((err as MonidError).code).toBe('NOT_FOUND');
    expect((err as MonidError).message).toBe('Run 01X not found');
  });
});

describe('MonidAPI sendDispute', () => {
  it('POSTs the body to /v1/dispute and returns the stored id', async () => {
    let sent: { url?: string; method?: string; body?: unknown } = {};
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      sent = { url, method: init?.method, body: JSON.parse(String(init?.body)) };
      return new Response(
        JSON.stringify({ disputeId: 'dp-1', createdAt: '2026-10-20T00:00:00.000Z' }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const body = {
      runIds: ['run-a'],
      reason: 'stale',
      context: { userQuery: 'latest posts', runIds: ['run-a'] },
    };
    const out = await api.sendDispute(body);
    expect(sent.method).toBe('POST');
    expect(sent.url).toBe('https://api.example.test/v1/dispute');
    expect(sent.body).toEqual(body);
    expect(out.disputeId).toBe('dp-1');
  });
});
