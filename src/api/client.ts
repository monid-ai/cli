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

    const data = await res.json() as T & ApiErrorResponse;

    if (!res.ok) {
      const message =
        data?.error?.message ?? data?.message ?? `HTTP ${res.status}`;
      const code = data?.error?.code ?? statusToCode(res.status);
      throw new MonidError(code, message, res.status);
    }

    return data;
  }

  async discover(
    query: string,
    limit?: number,
    minScore?: number,
  ): Promise<DiscoverResponse> {
    const body: Record<string, unknown> = { query };
    if (limit !== undefined) body.limit = limit;
    if (minScore !== undefined) body.minScore = minScore;
    return this.request('POST', '/v1/discover', body);
  }

  async inspect(
    provider: string,
    endpoint: string,
  ): Promise<InspectResponse> {
    return this.request('POST', '/v1/inspect', { provider, endpoint });
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

    return this.request('POST', '/v1/run', reqBody);
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
