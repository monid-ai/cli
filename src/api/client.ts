import { API_BASE_URL } from '../config/constants.js';
import { MonidError } from '../utils/error.js';
import type {
  BalanceResponse,
  DiscoverResponse,
  ExternalResourceDetail,
  InspectResponse,
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

export class MonidAPI {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: { baseUrl?: string; apiKey: string }) {
    this.baseUrl = (config.baseUrl ?? API_BASE_URL).replace(/\/+$/, '');
    this.apiKey = config.apiKey;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    /** Human label for a rate-limit message (`discover`, `tinyfish /search`). */
    label?: string,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'X-Monid-Client': 'cli',
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) {
      return undefined as T;
    }

    if (!res.ok) {
      // Parse defensively: an error body is not always JSON (e.g. the edge
      // firewall's own 429), and a parse failure must not hide the status.
      const text = await res.text();
      let data: ApiErrorResponse | undefined;
      try {
        data = JSON.parse(text) as ApiErrorResponse;
      } catch {
        data = undefined;
      }
      const message = data?.error?.message ?? data?.message ?? `HTTP ${res.status}`;
      const code = data?.error?.code ?? statusToCode(res.status);
      throw new MonidError(code, message, res.status, {
        retryAfterSec: positiveInt(res.headers.get('retry-after')),
        limitedOn: label ?? defaultLabel(method, path),
        providerRun: providerRunOf(data, res.status),
      });
    }

    return await res.json() as T;
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
    return this.request('POST', '/v1/discover', body, 'discover');
  }

  async inspect(
    provider: string,
    endpoint: string,
  ): Promise<InspectResponse> {
    return this.request('POST', '/v1/inspect', { provider, endpoint }, 'inspect');
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

    return this.request('POST', '/v1/run', reqBody, `${provider} ${endpoint}`);
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

function positiveInt(v: string | null): number | undefined {
  if (v === null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : undefined;
}

/**
 * A sync `POST /v1/run` returns the PROVIDER's HTTP status (401/403/429, or
 * 502 for a provider 402) with a COMPLETED run body, not Monid's
 * `{ code, message }` envelope. Return the run so the error is not
 * presented as Monid's own (expired key, workspace rate limit, ...). The
 * provider's real status is in `providerResponse.httpStatus`.
 */
function providerRunOf(
  data: unknown,
  httpStatus: number,
): { runId: string; httpStatus: number } | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const { status, runId, providerResponse } = data as {
    status?: unknown;
    runId?: unknown;
    providerResponse?: { httpStatus?: unknown };
  };
  if (status !== 'COMPLETED' || typeof runId !== 'string') return undefined;
  const providerStatus = providerResponse?.httpStatus;
  return {
    runId,
    httpStatus: typeof providerStatus === 'number' ? providerStatus : httpStatus,
  };
}

/** `GET /v1/runs/abc?x=1` → `GET /v1/runs/abc` */
function defaultLabel(method: string, path: string): string {
  return `${method} ${path.split('?')[0]}`;
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
