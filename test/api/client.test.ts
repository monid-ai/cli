import { describe, it, expect, afterEach } from 'bun:test';
import { MonidAPI } from '../../src/api/client.js';
import { MonidError } from '../../src/utils/error.js';
import { VERSION } from '../../src/config/constants.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answer the next request with this exact body, status and content type. */
function stubFetch(body: string, status: number, contentType: string): void {
  globalThis.fetch = (async () =>
    new Response(body, {
      status,
      headers: { 'content-type': contentType },
    })) as typeof fetch;
}

const api = new MonidAPI({ apiKey: 'test-key', baseUrl: 'https://api.example.test' });

/** The bare `<html>` + CRLF error page a gateway returns — not the API. */
const GATEWAY_HTML = '<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>...</body>\r\n</html>';

describe('MonidAPI request error handling', () => {
  it('reports the HTTP status when a gateway answers 5xx with HTML', async () => {
    // Regression: the body was parsed BEFORE the status was checked, so this
    // surfaced as `Unexpected token '<', "<html>..." is not valid JSON` and
    // the 502 was lost entirely.
    stubFetch(GATEWAY_HTML, 502, 'text/html');

    const err = await api.whoami().then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(MonidError);
    expect((err as MonidError).statusCode).toBe(502);
    expect((err as MonidError).code).toBe('HTTP_502');
    expect((err as MonidError).message).toBe('HTTP 502');
    expect((err as MonidError).message).not.toContain('Unexpected token');
  });

  it('keeps the mapped code for a non-JSON 401', async () => {
    stubFetch(GATEWAY_HTML, 401, 'text/html');

    const err = await api.whoami().then(() => null, (e: unknown) => e);
    expect((err as MonidError).code).toBe('AUTH_FAILED');
    expect((err as MonidError).statusCode).toBe(401);
  });

  it('still prefers a structured API error message over the status', async () => {
    stubFetch(
      JSON.stringify({ error: { code: 'INSUFFICIENT_BALANCE', message: 'Balance too low' } }),
      402,
      'application/json',
    );

    const err = await api.whoami().then(() => null, (e: unknown) => e);
    expect((err as MonidError).code).toBe('INSUFFICIENT_BALANCE');
    expect((err as MonidError).message).toBe('Balance too low');
  });

  it('names a 2xx that is not JSON instead of throwing a parse error', async () => {
    stubFetch('<html>\r\n<body>captive portal</body>\r\n</html>', 200, 'text/html');

    const err = await api.whoami().then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(MonidError);
    expect((err as MonidError).code).toBe('INVALID_RESPONSE');
    expect((err as MonidError).message).toContain('Expected JSON');
    expect((err as MonidError).message).toContain('text/html');
    expect((err as MonidError).message).not.toContain('Unexpected token');
  });

  it('describes an empty 2xx body rather than reporting a parse error', async () => {
    stubFetch('', 200, 'application/json');

    const err = await api.whoami().then(() => null, (e: unknown) => e);
    expect((err as MonidError).code).toBe('INVALID_RESPONSE');
    expect((err as MonidError).message).toContain('empty');
  });

  it('truncates a long non-JSON body in the error message', async () => {
    stubFetch('x'.repeat(5000), 200, 'text/plain');

    const err = await api.whoami().then(() => null, (e: unknown) => e);
    expect((err as MonidError).message).toContain('…');
    expect((err as MonidError).message.length).toBeLessThan(200);
  });

  it('returns the parsed payload on a normal 200', async () => {
    stubFetch(JSON.stringify({ workspace: 'Test Workspace' }), 200, 'application/json');

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

describe('MonidAPI network failures', () => {
  const fast = { apiKey: 'test-key', baseUrl: 'https://api.example.test', retryDelayMs: 0 };

  /** Reject like undici: TypeError('fetch failed') with the reason in cause. */
  function failedFetch(): TypeError {
    const cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    return new TypeError('fetch failed', { cause });
  }

  it('retries a read after a transient fetch failure and succeeds', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls < 3) throw failedFetch();
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const res = await new MonidAPI(fast).whoami();
    expect(res).toEqual({ ok: true } as never);
    expect(calls).toBe(3);
  });

  it('throws a descriptive NETWORK_ERROR once read retries are exhausted', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw failedFetch();
    }) as typeof fetch;

    const err = await new MonidAPI(fast).getRun('run_1').then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(MonidError);
    expect((err as MonidError).code).toBe('NETWORK_ERROR');
    expect((err as MonidError).message).toContain('ECONNRESET');
    expect((err as MonidError).message).toContain('GET /v1/runs/run_1');
    expect(calls).toBe(3);
  });

  it('never retries the paid run request and points to runs list', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw failedFetch();
    }) as typeof fetch;

    const err = await new MonidAPI(fast).run('anyapi', '/tiktok.search_keyword', { q: 'x' })
      .then(() => null, (e: unknown) => e);
    expect(calls).toBe(1);
    expect((err as MonidError).code).toBe('NETWORK_ERROR');
    expect((err as MonidError).message).toContain('monid runs list');
  });

  it('retries read-only discover', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) throw failedFetch();
      return new Response('{"results":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    await new MonidAPI(fast).discover('web search results');
    expect(calls).toBe(2);
  });
});
