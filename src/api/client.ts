import { API_BASE_URL, VERSION } from '../config/constants.js';
import { MonidError } from '../utils/error.js';
import type {
  BalanceResponse,
  DiscoverResponse,
  DisputeRequest,
  DisputeResponse,
  ExternalResourceDetail,
  FeedbackResponse,
  InspectResponse,
  PromoCodesListResponse,
  RedeemPromoCodeResponse,
  Resource,
  ResourceEventsResponse,
  ResourceListResponse,
  ResourceReleaseResponse,
  RunResponse,
  RunDetailResponse,
  RunStopResponse,
  SetupTelemetryRequest,
  RunsListResponse,
  ApiErrorResponse,
  WhoamiResponse,
  WorkspaceListResponse,
} from './types.js';

export class MonidPublicAPI {
  private baseUrl: string;

  constructor(config?: { baseUrl?: string }) {
    this.baseUrl = (config?.baseUrl ?? API_BASE_URL).replace(/\/+$/, '');
  }

  async sendSetupTelemetry(input: SetupTelemetryRequest): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    try {
      const res = await fetch(`${this.baseUrl}/public/v1/telemetry/skill-setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Total attempts (first try included) for a safely repeatable request. */
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 250;

export class MonidAPI {
  private baseUrl: string;
  private apiKey: string;
  private maxAttempts: number;
  private retryDelayMs: number;

  constructor(config: {
    baseUrl?: string;
    apiKey: string;
    maxAttempts?: number;
    retryDelayMs?: number;
  }) {
    this.baseUrl = (config.baseUrl ?? API_BASE_URL).replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.maxAttempts = Math.max(1, config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  /**
   * `fetch` rejects with a bare `TypeError: fetch failed` when the request
   * never completed (DNS, reset, TLS, timeout). Surfacing that verbatim gave
   * users `UNKNOWN: fetch failed` with no cause and no hint what to do next.
   *
   * Requests that are safe to repeat (`retryable`: reads) are retried a few
   * times with backoff. Everything else — above all the paid POST /v1/run —
   * is never repeated automatically, because the server may have received
   * the request before the connection dropped.
   *
   * The body is read HERE, inside the same try: a connection that drops after
   * the headers arrived makes `res.text()` reject with the same bare
   * `TypeError: terminated`, and that failure needs the same recovery (retry
   * a read, name the cause and warn about the paid run otherwise).
   */
  private async fetchWithRecovery(
    method: string,
    path: string,
    url: string,
    init: RequestInit,
    retryable: boolean,
  ): Promise<{ res: Response; raw: string }> {
    const attempts = retryable ? this.maxAttempts : 1;
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(url, init);
        const raw = res.status === 204 ? '' : await res.text();
        return { res, raw };
      } catch (cause) {
        if (attempt < attempts) {
          await new Promise((r) =>
            setTimeout(r, this.retryDelayMs * 2 ** (attempt - 1)),
          );
          continue;
        }
        throw networkError(method, path, cause, attempt, retryable);
      }
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: { idempotent?: boolean; acceptRunBody?: boolean },
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'X-Monid-Client': `cli@${VERSION}`,
    };

    const { res, raw } = await this.fetchWithRecovery(
      method,
      path,
      url,
      { method, headers, body: body ? JSON.stringify(body) : undefined },
      method === 'GET' || opts?.idempotent === true,
    );

    if (res.status === 204) {
      return undefined as T;
    }

    // Not every response on this socket comes from the API. A gateway, proxy
    // or load balancer in front of it answers 5xx with an HTML error page,
    // and an unparsed body must not cost us the status: parsing FIRST turned
    // a plain 502 into `Unexpected token '<', "<html>..." is not valid JSON`
    // and threw the status away, so an upstream blip read as a broken CLI.
    // Parse defensively and let the status drive the error instead.
    let data: (T & ApiErrorResponse) | undefined;
    let parsed = false;
    try {
      data = JSON.parse(raw) as T & ApiErrorResponse;
      parsed = true;
    } catch {
      // Body is not JSON — handled below, by status first.
    }

    if (!res.ok) {
      // A sync run the provider answered keeps the provider's HTTP status
      // (TIMED_OUT: 408), but the body is the finished run — a result to
      // render, not an error.
      if (opts?.acceptRunBody && isRunBody(data)) {
        return data as T;
      }
      const message =
        data?.error?.message ?? data?.message ?? `HTTP ${res.status}`;
      const code = data?.error?.code ?? statusToCode(res.status);
      throw new MonidError(code, message, res.status);
    }

    // 2xx that is not JSON is still a broken response — name it, and show
    // enough of the body to tell a captive portal from a bad deploy.
    if (!parsed) {
      throw new MonidError(
        'INVALID_RESPONSE',
        `Expected JSON from ${url} but got ${describeBody(res, raw)}`,
        res.status,
      );
    }

    return data as T;
  }

  async discover(
    query: string,
    limit?: number,
    minScore?: number,
    includeUnavailable?: boolean,
  ): Promise<DiscoverResponse> {
    const body: Record<string, unknown> = { query };
    if (limit !== undefined) body.limit = limit;
    if (minScore !== undefined) body.minScore = minScore;
    // Sent only when opting IN, so the request body is byte-identical to
    // before for every existing caller (the server defaults it to false).
    if (includeUnavailable) body.includeUnavailable = true;
    return this.request('POST', '/v1/discover', body, { idempotent: true });
  }

  async inspect(
    provider: string,
    endpoint: string,
  ): Promise<InspectResponse> {
    return this.request('POST', '/v1/inspect', { provider, endpoint }, { idempotent: true });
  }

  async run(
    provider: string,
    endpoint: string,
    body?: Record<string, unknown>,
    queryParams?: Record<string, unknown>,
    pathParams?: Record<string, unknown>,
  ): Promise<RunResponse> {
    let input: Record<string, unknown> = {};
    if (body && Object.keys(body).length > 0) input.body = body;
    if (queryParams && Object.keys(queryParams).length > 0) input.queryParams = queryParams;
    if (pathParams && Object.keys(pathParams).length > 0) input.pathParams = pathParams;

    const reqBody: Record<string, unknown> = { provider, endpoint };
    if (Object.keys(input).length > 0) reqBody.input = input;

    return this.request('POST', '/v1/run', reqBody, { acceptRunBody: true });
  }

  async getRun(runId: string): Promise<RunDetailResponse> {
    return this.request('GET', `/v1/runs/${encodeURIComponent(runId)}`);
  }

  async stopRun(runId: string): Promise<RunStopResponse> {
    return this.request('POST', `/v1/runs/${encodeURIComponent(runId)}/stop`);
  }

  async getBalance(): Promise<BalanceResponse> {
    return this.request('GET', '/v1/wallet/balance');
  }

  async listRuns(
    limit?: number,
    cursor?: string,
  ): Promise<RunsListResponse> {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);
    const qs = params.toString();
    return this.request('GET', `/v1/runs${qs ? `?${qs}` : ''}`);
  }

  // --- Promo codes ---

  async listPromoCodes(
    limit?: number,
    cursor?: string,
  ): Promise<PromoCodesListResponse> {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);
    const qs = params.toString();
    return this.request('GET', `/v1/wallet/promo-codes${qs ? `?${qs}` : ''}`);
  }

  async redeemPromoCode(code: string): Promise<RedeemPromoCodeResponse> {
    return this.request('POST', '/v1/wallet/promo-codes/redeem', { code });
  }

  // --- Feedback ---

  async sendFeedback(text: string, runId?: string): Promise<FeedbackResponse> {
    const body: Record<string, unknown> = { text };
    if (runId) body.runId = runId;
    return this.request('POST', '/v1/feedback', body);
  }

  // --- Dispute ---

  async sendDispute(input: DisputeRequest): Promise<DisputeResponse> {
    return this.request('POST', '/v1/dispute', input);
  }

  // --- Auth ---

  async whoami(): Promise<WhoamiResponse> {
    return this.request('GET', '/v1/auth/whoami');
  }

  async listWorkspaces(): Promise<WorkspaceListResponse> {
    return this.request('GET', '/v1/auth/workspaces');
  }

  // --- Resources ---

  async listResources(opts?: {
    provider?: string;
    resourceType?: string;
    state?: string;
    limit?: number;
    cursor?: string;
  }): Promise<ResourceListResponse> {
    const params = new URLSearchParams();
    if (opts?.provider) params.set('provider', opts.provider);
    if (opts?.resourceType) params.set('resourceType', opts.resourceType);
    if (opts?.state) params.set('state', opts.state);
    if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts?.cursor) params.set('cursor', opts.cursor);
    const qs = params.toString();
    return this.request('GET', `/v1/resources${qs ? `?${qs}` : ''}`);
  }

  async getResource(resourceId: string): Promise<Resource> {
    return this.request('GET', `/v1/resources/${encodeURIComponent(resourceId)}`);
  }

  async getResourceExternal(
    resourceId: string,
    kind: string,
  ): Promise<ExternalResourceDetail> {
    return this.request(
      'GET',
      `/v1/resources/${encodeURIComponent(resourceId)}/external/${encodeURIComponent(kind)}`,
    );
  }

  async listResourceEvents(
    resourceId: string,
    opts?: { limit?: number; cursor?: string },
  ): Promise<ResourceEventsResponse> {
    const params = new URLSearchParams();
    if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts?.cursor) params.set('cursor', opts.cursor);
    const qs = params.toString();
    return this.request(
      'GET',
      `/v1/resources/${encodeURIComponent(resourceId)}/events${qs ? `?${qs}` : ''}`,
    );
  }

  async releaseResource(resourceId: string): Promise<ResourceReleaseResponse> {
    return this.request(
      'POST',
      `/v1/resources/${encodeURIComponent(resourceId)}/release`,
    );
  }
}

/** Name the failure and say what is safe to do next. */
function networkError(
  method: string,
  path: string,
  cause: unknown,
  attempts: number,
  retried: boolean,
): MonidError {
  const detail = describeCause(cause);
  const tried = attempts > 1 ? ` after ${attempts} attempts` : '';
  let hint: string;
  if (retried) {
    hint = 'This looks like a transient network problem; try again shortly.';
  } else if (method === 'POST' && path === '/v1/run') {
    hint =
      'No response was received, so the run may or may not have been created ' +
      "(runs are paid and are not retried automatically). Check 'monid runs list' " +
      'before running again.';
  } else {
    hint =
      'No response was received, so the request may or may not have been applied. ' +
      'Check its effect before repeating it.';
  }
  const err = new MonidError(
    'NETWORK_ERROR',
    `Network request failed${tried} (${method} ${path}): ${detail}. ${hint}`,
  );
  (err as Error & { cause?: unknown }).cause = cause;
  return err;
}

/** `fetch failed` hides the real reason in `cause` (e.g. ECONNRESET). */
function describeCause(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause);
  const inner = (cause as Error & { cause?: unknown }).cause;
  if (inner instanceof Error) {
    const code = (inner as Error & { code?: string }).code;
    const text = inner.message || inner.name;
    return `${cause.message}: ${code && !text.includes(code) ? `${code} ` : ''}${text}`;
  }
  return cause.message || cause.name;
}

/**
 * Describe a body that failed to parse as JSON, for an error message.
 * Reports the declared content type and a short, whitespace-collapsed
 * snippet — enough to identify an HTML error page or a captive portal
 * without dumping a whole document into the terminal.
 */
function describeBody(res: Response, raw: string): string {
  const type = res.headers.get('content-type')?.split(';')[0]?.trim();
  const snippet = raw.trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!snippet) {
    return type ? `an empty ${type} body` : 'an empty body';
  }
  return `${type ?? 'an unknown content type'}: ${snippet}${raw.trim().length > 80 ? '…' : ''}`;
}

/** A run (`runId` + `status`), as opposed to a `{ code, message }` error. */
function isRunBody(data: unknown): boolean {
  return typeof data === 'object' && data !== null && 'runId' in data && 'status' in data;
}

function statusToCode(status: number): string {
  switch (status) {
    case 401:
      return 'AUTH_FAILED';
    case 402:
      return 'INSUFFICIENT_BALANCE';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 429:
      return 'RATE_LIMITED';
    default:
      return `HTTP_${status}`;
  }
}
