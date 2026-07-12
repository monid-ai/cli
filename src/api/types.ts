// --- Shared types ---

/**
 * One money amount on the price wire. Current backends send the nested
 * `{ value, currency }` shape (same as every other money field — cost,
 * billing); pre-2026-07 backends sent a bare dollar number with a top-level
 * `currency`. The CLI accepts BOTH so it renders correctly against any
 * backend version (rendering `[object Object]` was the failure mode when
 * only the old shape was understood).
 */
export type PriceAmount = number | { value: number; currency: string };

/** A `{unit, count}` billing period — BY_PERIOD's `period`, METERED's `per`. */
export interface PricePeriod {
  unit: string;
  count: number;
}

export interface Price {
  /** PER_CALL | PER_RESULT | BY_PERIOD | METERED | PER_UNIT_MATRIX (open for
   *  forward compat — unknown types render as a bare amount). */
  type: string;
  amount: PriceAmount;
  flatFee?: PriceAmount;
  /** Old wire shape only (new shape carries currency inside each amount). */
  currency?: string;
  /** BY_PERIOD: the recurring billing period (e.g. {unit:"MONTH",count:1}). */
  period?: PricePeriod;
  /** METERED: the metering quantum (e.g. {unit:"MINUTE",count:1}) — the unit
   *  `billedUnits` counts. */
  per?: PricePeriod;
  /** PER_UNIT_MATRIX: displayable price table. */
  selectors?: { label: string; key: string; in: string }[];
  variants?: { when: Record<string, string | number>; amount: PriceAmount; label?: string }[];
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

/** Optional, free-form hints map that any response may carry on the top level. */
export type Hints = Record<string, unknown>;

/** @deprecated Renamed to `Hints`. Kept for backward compatibility. */
export type Usage = Hints;

export type RunStatus =
  | 'READY'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'BLOCKED'
  | 'STOPPED'
  | 'TIME_OUT';

// --- Control Snapshots ---

export interface MonetaryValue {
  value: number;
  currency: string;
}

export type WorkspaceBudgetPeriod = string;

export interface BudgetControlSnapshot {
  type: 'WORKSPACE_BUDGET';
  period: WorkspaceBudgetPeriod;
  limitAmount: MonetaryValue;
  availableAmount: MonetaryValue;
  heldAmount: MonetaryValue;
  spentAmount: MonetaryValue;
  windowStart: string;
}

export interface RunCapControlSnapshot {
  type: 'WORKSPACE_RUN_CAP';
  limitAmount: MonetaryValue;
}

export type ControlSnapshot = BudgetControlSnapshot | RunCapControlSnapshot;

/** A control snapshot that contributed to blocking a run. */
export interface RunControl {
  controlId: string;
  snapshot: ControlSnapshot;
}

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
  hints?: Hints;
  /** @deprecated Use `hints` instead. */
  usage?: Usage;
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
  hints?: Hints;
  /** @deprecated Use `hints` instead. */
  usage?: Usage;
}

// --- Run ---

export interface RunResponse {
  runId: string;
  provider: string;
  endpoint: string;
  status: RunStatus;
  price: Price;
  cost?: Cost | null;
  createdAt: string;
  providerResponse?: ProviderResponse;
  /** Control snapshots that blocked the run (present when status is BLOCKED). */
  controls?: RunControl[];
  hints?: Hints;
  /** @deprecated Use `hints` instead. */
  usage?: Usage;
}

export interface RunDetailResponse {
  runId: string;
  caller: string;
  provider: string;
  providerName?: string;
  endpoint: string;
  status: RunStatus;
  input?: EndpointInput;
  output?: Record<string, unknown>;
  error?: RunError | string;
  /** Whether the run can currently be stopped via `monid runs stop`. Present on run detail. */
  stoppable?: boolean;
  providerResponse?: ProviderResponse;
  price: Price;
  cost?: Cost | null;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  /** Control snapshots that blocked the run (present when status is BLOCKED). */
  controls?: RunControl[];
  hints?: Hints;
  /** @deprecated Use `hints` instead. */
  usage?: Usage;
}

// --- Run Stop ---

export interface RunStopResponse {
  runId: string;
  status: RunStatus;
  message?: string;
}

// --- Runs List ---

export interface RunListItem {
  runId: string;
  caller: string;
  provider: string;
  providerName?: string;
  endpoint: string;
  status: RunStatus;
  error?: RunError | string;
  providerResponse?: ProviderResponse;
  price: Price;
  cost?: Cost | null;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  /** Control snapshots that blocked the run (present when status is BLOCKED). */
  controls?: RunControl[];
}

export interface RunsListResponse {
  items: RunListItem[];
  cursor: string | null;
  hints?: Hints;
  /** @deprecated Use `hints` instead. */
  usage?: Usage;
}

// --- Balance ---

export interface BalanceResponse {
  balance: {
    value: number;
    currency: string;
  };
  hints?: Hints;
  /** @deprecated Use `hints` instead. */
  usage?: Usage;
}

// --- Public Telemetry ---

export interface SetupTelemetryRequest {
  source: 'cli';
  client?: string;
  email?: string;
}

// --- API Error ---

export interface ApiErrorResponse {
  error?: {
    message?: string;
    code?: string;
  };
  message?: string;
}
