// --- Shared types ---

/**
 * One money amount on the price wire. Current backends send the nested
 * `{ value, currency }` shape (same as every other money field — cost,
 * billing); pre-2026-07 backends sent a bare dollar number with a top-level
 * `currency`. The CLI accepts BOTH so it renders correctly against any
 * backend version (rendering `[object Object]` was the failure mode when
 * only the old shape was understood).
 */
export type MonetaryAmount = { value: number; currency: string };

/**
 * A price `amount` on the wire. Historically a bare dollar number or a nested
 * `{ value, currency }`. Newer backends may send a *nested price structure*
 * where `amount` is itself a priced sub-expression — e.g. a `PER_UNIT_MATRIX`
 * whose `amount` is a `PER_TOKEN` price (`{ type, amount, per }`). The type is
 * therefore recursive: any `amount` may be a number, a `{value,currency}`, or
 * another `NestedPrice`. Renderers must recurse and degrade gracefully for
 * unknown shapes (never emit `[object Object]`).
 */
export type PriceAmount = number | MonetaryAmount | NestedPrice;

/**
 * A priced sub-expression carried inside a `PriceAmount`. Shares the shape of
 * `Price` (type + amount + optional modifiers) but is intentionally minimal and
 * open for forward compat. `per` is a plain divisor count (e.g. 1_000_000 for
 * "per 1M tokens"), distinct from the `{unit,count}` `PricePeriod`.
 */
export interface NestedPrice {
  type: string;
  amount: PriceAmount;
  /** Divisor for per-unit pricing, e.g. `1000000` → "per 1M". */
  per?: number;
  flatFee?: PriceAmount;
  period?: PricePeriod;
}

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

// --- Auth ---

export interface AuthUser {
  userId: string;
  username: string;
  email?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AuthWorkspace {
  workspaceId: string;
  name: string;
  slug: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WhoamiResponse {
  user: AuthUser;
  /** Absent when the caller is not part of a workspace. */
  workspace?: AuthWorkspace;
  hints?: Hints;
  usage?: Usage;
}

export interface WorkspaceListItem {
  workspaceId: string;
  slug: string | null;
}

export interface WorkspaceListResponse {
  workspaces: WorkspaceListItem[];
  hints?: Hints;
  usage?: Usage;
}

// --- Resources ---

export type ResourceState =
  | 'READY'
  | 'PROVISIONING'
  | 'ACTIVE'
  | 'EXPIRING'
  | 'SUSPENDED'
  | 'RELEASED'
  | 'PROVISION_FAILED';

/** Summary of an external link on a resource (from `Resource.externalResources`). */
export interface ExternalResourceSummary {
  kind: string;
  displayName: string;
  label?: string;
}

/** Live external detail fetched from `/v1/resources/{id}/external/{kind}`. */
export interface ExternalResourceDetail {
  kind: string;
  displayName: string;
  label?: string;
  data: Record<string, unknown>;
}

export interface ResourceRenewal {
  price: Price;
  /** How long before `currentPeriodEnd` charging starts. */
  renewLead: { unit: string; count: number };
  startedAt: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  renewAttemptAt: string;
  cycle: number;
  lastAttempt?: {
    at: string;
    outcome: 'SUCCEEDED' | 'FAILED';
    reason?: string;
  };
  cancelledAt?: string;
}

export interface Resource {
  resourceId: string;
  provider: string;
  resourceSlug: string;
  resourceType: string;
  externalId: string;
  identifier: string;
  state: ResourceState;
  provisionedBy: string;
  releasedBy?: string;
  renewal?: ResourceRenewal;
  createdAt: string;
  updatedAt: string;
  releasedAt?: string;
  releaseReasonCode?: string;
  releaseReason?: string;
  phoneNumber?: string;
  country?: string;
  numberType?: string;
  externalResources?: ExternalResourceSummary[];
  syncedAt?: string;
  hints?: Hints;
  usage?: Usage;
}

/** `resources get` output: the base resource plus joined live external detail. */
export interface ResourceWithExternal extends Resource {
  /** Live external detail, fetched per `externalResources[].kind` and joined in. */
  externalDetails?: ResourceExternalJoin[];
}

/** One joined external link — either its live detail or a per-link fetch error. */
export interface ResourceExternalJoin {
  kind: string;
  displayName: string;
  label?: string;
  data?: Record<string, unknown>;
  /** Present when the live fetch failed (e.g. provider unreachable). */
  error?: string;
}

export interface ResourceListResponse {
  items: Resource[];
  cursor?: string | null;
  hints?: Hints;
  usage?: Usage;
}

export interface ResourceEvent {
  eventId: string;
  type: string;
  cycle?: number;
  amount?: { value: number; currency: string };
  reason?: string;
  at: string;
}

export interface ResourceEventsResponse {
  items: ResourceEvent[];
  cursor?: string | null;
  hints?: Hints;
  usage?: Usage;
}

export interface ResourceReleaseResponse {
  resourceId: string;
  state: 'EXPIRING';
  message: string;
  hints?: Hints;
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
