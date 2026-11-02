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

  /** Headers arrived, then the socket dropped while the body was streaming. */
  function bodyDropResponse(): Response {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => {
        throw new TypeError('terminated', {
          cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
        });
      },
    } as unknown as Response;
  }

  it('retries a read whose body stream drops after the headers', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) return bodyDropResponse();
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const res = await new MonidAPI(fast).whoami();
    expect(res).toEqual({ ok: true } as never);
    expect(calls).toBe(2);
  });

  it('does not retry a run whose body stream drops, and still names the cause', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return bodyDropResponse();
    }) as typeof fetch;

    const err = await new MonidAPI(fast).run('anyapi', '/x', { q: 'x' })
      .then(() => null, (e: unknown) => e);
    expect(calls).toBe(1);
    expect((err as MonidError).code).toBe('NETWORK_ERROR');
    expect((err as MonidError).message).toContain('UND_ERR_SOCKET');
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

describe('MonidAPI run: provider non-2xx', () => {
  // Bodies rendered by the API's own `buildCompletedRunBody` (services
  // `routes/_shared/run-response.ts`) for a sync COMPLETED run: the response
  // status mirrors the provider's (402 → 502), the body is the whole run.
  // 403: prod run 01M4Z0C45J63GV8C76P6YJRFTK. 502: Clay all-items-failed,
  // vendor body from the stored output of run 01M5C69MG6RAK9DTHH9X1NAF43.
  const RUN_403 = {
    runId: '01M4Z0C45J63GV8C76P6YJRFTK',
    provider: 'contactout',
    endpoint: '/v1/email/verify',
    status: 'COMPLETED',
    output: null,
    providerResponse: {
      httpStatus: 403,
      error: {
        message: "You're out of credits, please email your sales manager or book a meeting: https://contactout.com/meeting?utm_source=api-out-of-credits",
        status_code: 403,
      },
    },
    price: {
      type: 'PER_RESULT',
      amount: { value: 0.01, currency: 'USD' },
      notes: ['Charged only on a definitive verdict — disposable and unknown results are free.'],
    },
    billing: { reportedCost: { currency: 'USD', value: 0, unit: 'MICRO_DOLLAR' } },
    resultCount: 0,
    billedUnits: 0,
    createdAt: '2026-10-15T05:25:47.649Z',
    completedAt: '2026-10-15T05:25:48.178Z',
    hints: {
      'inspect the endpoint': 'monid inspect -p contactout -e /v1/email/verify',
      'find other endpoints': "monid discover -q '<QUERY>'",
      'run again': "monid run -p contactout -e /v1/email/verify -i '<BODY>' --query '<QUERY_PARAMS>' --path '<PATH_PARAMS>'",
    },
  };
  const RUN_502 = {
    runId: '01M5C69MG6RAK9DTHH9X1NAF43',
    provider: 'clay',
    endpoint: '/enrichment/mobile-phone',
    status: 'COMPLETED',
    output: null,
    providerResponse: {
      httpStatus: 502,
      error: {
        routine_run_id: 'run_0tn75sdAB7ZDqrkBC2E',
        status: 'complete',
        total: 1,
        finished: 1,
        data: [
          {
            id: '01M5C69MG6RAK9DTHH9X1NAF43',
            status: 'failed',
            error: { message: 'Function column "Find phone numbers": Find phone numbers: Not enough Clay credits 😢' },
          },
        ],
      },
    },
    price: { type: 'PER_CALL', amount: { value: 0.568, currency: 'USD' } },
    billing: { reportedCost: { currency: 'USD', value: 0, unit: 'MICRO_DOLLAR' } },
    resultCount: 0,
    billedUnits: 0,
    createdAt: '2026-10-24T18:02:11.000Z',
    completedAt: '2026-10-24T18:02:19.000Z',
    hints: {
      'inspect the endpoint': 'monid inspect -p clay -e /enrichment/mobile-phone',
      'find other endpoints': "monid discover -q '<QUERY>'",
      'run again': "monid run -p clay -e /enrichment/mobile-phone -i '<BODY>' --query '<QUERY_PARAMS>' --path '<PATH_PARAMS>'",
    },
  };

  it('returns a 403 run body as the run, with the provider error', async () => {
    stubFetch(JSON.stringify(RUN_403), 403, 'application/json');

    const out = await api.run('contactout', '/v1/email/verify', { email: 'a@b.co' });
    expect(out).toEqual(RUN_403);
  });

  it('returns a 502 run body as the run, with the provider error', async () => {
    stubFetch(JSON.stringify(RUN_502), 502, 'application/json');

    const out = await api.run('clay', '/enrichment/mobile-phone', { name: 'x' });
    expect(out).toEqual(RUN_502);
  });
});
