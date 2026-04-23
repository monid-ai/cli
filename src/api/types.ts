// --- Shared types ---

export interface Price {
  type: 'PER_CALL' | 'PER_RESULT';
  amount: number;
  flatFee?: number;
  currency: string;
  notes?: string[];
}

export interface Cost {
  value: number;
  currency: string;
}

export interface RunError {
  source: 'provider' | 'platform';
  message: string;
}

export interface ProviderResponse {
  httpStatus: number;
  data?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

export type RunStatus = 'READY' | 'RUNNING' | 'COMPLETED' | 'FAILED';

// --- Discover ---

export interface DiscoverResult {
  provider: string;
  providerName: string;
  endpoint: string;
  description: string;
  price: Price;
  score: number;
  tags: string[];
}

export interface DiscoverResponse {
  results: DiscoverResult[];
  query: string;
  count: number;
}

// --- Endpoint Input (structured) ---

export interface EndpointInput {
  pathParams?: Record<string, unknown>;
  queryParams?: Record<string, unknown>;
  body?: Record<string, unknown>;
  bodyType?: string;
}

// --- Inspect ---

export interface InspectResponse {
  id: string;
  provider: string;
  providerName: string;
  endpoint: string;
  description: string;
  summary?: string;
  /** Structured input — JSON Schema per param location (path, query, body). Preferred over inputSchema. */
  input?: EndpointInput;
  /** Legacy flat input schema. Used as fallback when `input` is absent. */
  inputSchema?: Record<string, unknown>;
  price: Price;
  tags?: string[];
  docUrl?: string;
  notes?: string[];
  usage: {
    api: string;
    apiX402?: string;
    cli: string;
    cliX402?: string;
  };
}

// --- Run ---

export interface RunResponse {
  runId: string;
  provider: string;
  endpoint: string;
  status: RunStatus;
  price: Price;
  createdAt: string;
  providerResponse?: ProviderResponse;
}

export interface RunDetailResponse {
  runId: string;
  caller: string;
  provider: string;
  providerName?: string;
  endpoint: string;
  status: RunStatus;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: RunError;
  providerResponse?: ProviderResponse;
  price: Price;
  cost?: Cost | null;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

// --- Runs List ---

export interface RunListItem {
  runId: string;
  caller: string;
  provider: string;
  providerName?: string;
  endpoint: string;
  status: RunStatus;
  error?: RunError;
  providerResponse?: ProviderResponse;
  price: Price;
  cost?: Cost | null;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface RunsListResponse {
  items: RunListItem[];
  cursor: string | null;
}

// --- Balance ---

export interface BalanceResponse {
  balance: {
    value: number;
    currency: string;
  };
}

// --- API Error ---

export interface ApiErrorResponse {
  error?: {
    message?: string;
    code?: string;
  };
  message?: string;
}
