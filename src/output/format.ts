import chalk from 'chalk';
import { renderTable } from './table.js';
import { statusBadge, price as formatPrice } from './colors.js';
import type {
  BalanceResponse,
  ControlSnapshot,
  DiscoverResponse,
  EndpointInput,
  InspectResponse,
  MonetaryValue,
  Price,
  PriceAmount,
  RunControl,
  RunError,
  RunDetailResponse,
  RunsListResponse,
} from '../api/types.js';
import type { CredentialKey } from '../config/types.js';

// --- Discover ---

export function formatDiscoverResults(data: DiscoverResponse): void {
  if (data.results.length === 0) {
    console.log(chalk.gray('No results found.'));
    return;
  }

  const headers = ['Provider', 'Endpoint', 'Price', 'Description', 'Verified'];
  const rows = data.results.map((r) => [
    r.provider,
    r.endpoint,
    formatPriceCompact(r.price),
    truncate(r.description, 50),
    hasTag(r.tags, 'verified') ? chalk.green('✓') : '',
  ]);

  renderTable(headers, rows, { columns: { 4: { align: 'center' } } });

  formatHints(data.hints ?? data.usage);
}

// --- Inspect ---

export function formatInspectResult(data: InspectResponse): void {
  console.log();

  console.log(chalk.bold('Provider'));
  console.log(`  ${data.providerName} (${data.provider})`);
  console.log();

  console.log(chalk.bold('Endpoint'));
  console.log(`  ${data.endpoint}`);

  console.log();
  console.log(chalk.bold('Description'));
  console.log(`  ${data.description}`);

  if (hasTag(data.tags, 'verified')) {
    console.log();
    console.log(chalk.dim('✓ Verified'));
  }

  if (data.summary) {
    console.log();
    console.log(chalk.bold('Summary'));
    console.log(`  ${data.summary}`);
  }

  console.log();
  console.log(chalk.bold('Pricing'));
  console.log(
    `  Type:   ${data.price.type}\n` +
    `  Amount: ${formatPriceCompact(data.price)}`,
  );
  const flatFee = amountValue(data.price.flatFee);
  if (flatFee) {
    console.log(`  Flat fee: $${flatFee}`);
  }
  if (data.price.type === 'PER_UNIT_MATRIX' && data.price.variants?.length) {
    console.log(`  Variants: ${data.price.variants.length} (price varies by input)`);
  }

  if (data.price.notes?.length) {
    console.log('  Notes:');
    data.price.notes.forEach((n) => {
      console.log(`    - ${n}`);
    });
  }

  if (data.input) {
    console.log();
    console.log(chalk.bold('Input'));
    formatStructuredInput(data.input);
  } else if (data.inputSchema) {
    console.log();
    console.log(chalk.bold('Input Schema'));
    console.log(JSON.stringify(data.inputSchema, null, 2));
  }

  if (data.docUrl) {
    console.log();
    console.log(chalk.bold('Documentation'));
    console.log(`  ${chalk.cyan(data.docUrl)}`);
  }

  if (data.notes?.length) {
    console.log();
    console.log(chalk.bold('Notes'));
    for (const note of data.notes) {
      console.log(`  - ${note}`);
    }
  }

  formatHints(data.hints ?? data.usage);

  console.log();
}

// --- Run Detail ---

export function resolveOutput(data: RunDetailResponse): Record<string, unknown> | undefined {
  return data.providerResponse?.data ?? data.providerResponse?.error ?? data.output;
}

export function formatRunDetail(data: RunDetailResponse): void {
  console.log();
  console.log(chalk.bold('Run Details'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  Run ID:   ${data.runId}`);
  console.log(`  Provider: ${data.providerName || data.provider}`);
  console.log(`  Endpoint: ${data.endpoint}`);
  console.log(`  Status:   ${statusBadge(data.status)}`);

  if (data.providerResponse) {
    const status = data.providerResponse.httpStatus;
    const statusColor = status >= 400 ? chalk.red : status >= 200 && status < 300 ? chalk.green : chalk.yellow;
    console.log(`  Provider Response: ${statusColor(status.toString())}`);
  }

  if (data.cost !== undefined && data.cost !== null) {
    console.log(`  Cost:     $${data.cost.value.toFixed(4)} ${data.cost.currency}`);
  }

  console.log(`  Created:  ${formatDate(data.createdAt)}`);
  if (data.completedAt) {
    console.log(`  Completed: ${formatDate(data.completedAt)}`);
  }

  const errorText = formatRunError(data.error);
  if (errorText) {
    console.log();
    console.log(chalk.red(`  Error: ${errorText}`));
  }

  if (data.controls?.length) {
    console.log();
    console.log(chalk.bold('Blocking Controls'));
    for (const control of data.controls) {
      formatRunControl(control);
    }
  }

  const normalizedInput = normalizeRunInput(data.input);
  if (normalizedInput) {
    console.log();
    console.log(chalk.bold('Input'));
    formatStructuredInput(normalizedInput);
  }

  const output = resolveOutput(data);
  if (output) {
    console.log();
    console.log(chalk.bold('Output'));
    console.log(JSON.stringify(output, null, 2));
  }

  if (data.stoppable) {
    console.log();
    console.log(chalk.dim(`This run is stoppable. Stop it with: monid runs stop -r ${data.runId}`));
  }

  formatHints(data.hints ?? data.usage);

  console.log();
}

// --- Runs List ---

export function formatRunsList(data: RunsListResponse): void {
  if (data.items.length === 0) {
    console.log(chalk.gray('No runs found.'));
    return;
  }

  const headers = ['Run ID', 'Provider', 'Endpoint', 'Status', 'Response', 'Cost', 'Created'];
  const rows = data.items.map((r) => [
    r.runId.slice(0, 12) + '...',
    r.providerName || r.provider,
    r.endpoint,
    statusBadge(r.status),
    formatHttpStatus(r.providerResponse?.httpStatus),
    r.cost ? `$${r.cost.value.toFixed(4)}` : '-',
    formatDate(r.createdAt),
  ]);

  renderTable(headers, rows);

  if (data.cursor) {
    console.log(chalk.gray(`More results available. Use --cursor ${data.cursor}`));
  }

  formatHints(data.hints ?? data.usage);
}

// --- Keys List ---

export function formatKeysList(
  keys: Record<string, CredentialKey>,
  activeLabel: string,
): void {
  const entries = Object.entries(keys);
  if (entries.length === 0) {
    console.log(chalk.gray('No API keys configured. Run "monid keys add" to add one.'));
    return;
  }

  const headers = ['Label', 'Key', 'Added At', 'Active'];
  const rows = entries.map(([label, cred]) => [
    label,
    `${cred.prefix}*******`,
    formatDate(cred.added_at),
    label === activeLabel ? chalk.green('★') : '',
  ]);

  renderTable(headers, rows);
}

// --- Balance ---

export function formatBalance(data: BalanceResponse): void {
  console.log();
  console.log(`  Balance: ${chalk.green(`$${data.balance.value.toFixed(2)}`)} ${data.balance.currency}`);
  formatHints(data.hints ?? data.usage);
  console.log();
}

// --- Structured Input ---

/** Check whether a value is a non-empty object (has at least one key). */
function isNonEmpty(obj: Record<string, unknown> | undefined): obj is Record<string, unknown> {
  return obj !== undefined && Object.keys(obj).length > 0;
}

/**
 * Normalize a run-detail `input` field into `EndpointInput` shape.
 *
 * New API shape: `{ body, queryParams, pathParams }` nested under input.
 * Legacy shape: a flat map representing only the body — coerced to `{ body: ... }`.
 * Returns `undefined` for empty/missing input so callers can skip the section.
 */
function normalizeRunInput(raw: unknown): EndpointInput | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return undefined;

  const hasNewShape =
    'body' in obj || 'queryParams' in obj || 'pathParams' in obj;
  if (hasNewShape) {
    return obj as EndpointInput;
  }
  return { body: obj as Record<string, unknown> };
}

function formatStructuredInput(input: EndpointInput): void {
  const hasPath = isNonEmpty(input.pathParams);
  const hasQuery = isNonEmpty(input.queryParams);
  const hasBody = isNonEmpty(input.body);

  if (!hasPath && !hasQuery && !hasBody) {
    console.log('  No input required.');
    return;
  }

  if (hasPath) {
    console.log(`  ${chalk.gray('Path Params')}`);
    console.log(JSON.stringify(input.pathParams, null, 2));
  }

  if (hasQuery) {
    console.log(`  ${chalk.gray('Query Params')}`);
    console.log(JSON.stringify(input.queryParams, null, 2));
  }

  if (hasBody) {
    const label = input.bodyType ? `Body (${input.bodyType})` : 'Body';
    console.log(`  ${chalk.gray(label)}`);
    console.log(JSON.stringify(input.body, null, 2));
  }
}

// --- Hints (flexible, optional) ---

/**
 * Render an optional, free-form `hints` map that any response may carry.
 *
 * Accepts the new `hints` field or the deprecated `usage` field (callers pass
 * `data.hints ?? data.usage`). The shape is not fixed: whatever keys are present
 * are rendered as `Label: value`. Absent/empty input renders nothing.
 * `undefined`/`null` values are skipped (never printed). Object/array values
 * are JSON-stringified; everything else is coerced to a string.
 */
export function formatHints(hints: Record<string, unknown> | undefined): void {
  if (!hints || typeof hints !== 'object') return;
  const entries = Object.entries(hints).filter(
    ([, value]) => value !== undefined && value !== null,
  );
  if (entries.length === 0) return;

  console.log();
  console.log(chalk.bold('Hints'));
  for (const [key, value] of entries) {
    const rendered = typeof value === 'object' ? JSON.stringify(value) : String(value);
    console.log(`  ${chalk.gray(`${key}:`)} ${rendered}`);
  }
}

// --- Control Snapshots ---

function formatMonetary(m: MonetaryValue): string {
  return `$${m.value.toFixed(4)} ${m.currency}`;
}

function formatRunControl(control: RunControl): void {
  console.log(`  ${chalk.gray('Control ID:')} ${control.controlId}`);
  formatControlSnapshot(control.snapshot);
  console.log();
}

function formatControlSnapshot(snapshot: ControlSnapshot): void {
  switch (snapshot.type) {
    case 'WORKSPACE_BUDGET':
      console.log(`    ${chalk.gray('Type:')}      Workspace Budget`);
      console.log(`    ${chalk.gray('Period:')}    ${snapshot.period}`);
      console.log(`    ${chalk.gray('Window:')}    ${formatDate(snapshot.windowStart)}`);
      console.log(`    ${chalk.gray('Limit:')}     ${formatMonetary(snapshot.limitAmount)}`);
      console.log(`    ${chalk.gray('Available:')} ${formatMonetary(snapshot.availableAmount)}`);
      console.log(`    ${chalk.gray('Held:')}      ${formatMonetary(snapshot.heldAmount)}`);
      console.log(`    ${chalk.gray('Spent:')}     ${formatMonetary(snapshot.spentAmount)}`);
      break;
    case 'WORKSPACE_RUN_CAP':
      console.log(`    ${chalk.gray('Type:')}  Workspace Run Cap`);
      console.log(`    ${chalk.gray('Limit:')} ${formatMonetary(snapshot.limitAmount)}`);
      break;
    default:
      // Unknown/future control type — render raw so it still surfaces.
      console.log(`    ${JSON.stringify(snapshot, null, 2)}`);
  }
}

// --- Helpers ---

/**
 * Normalize a run-level `error` into a display string. The API may send `error`
 * as a plain string or as a structured `{ source, message }` object. Returns
 * `undefined` for empty/missing errors so callers can skip the section.
 */
function formatRunError(error: RunError | string | undefined): string | undefined {
  if (!error) return undefined;
  if (typeof error === 'string') {
    return error.trim() || undefined;
  }
  if (!error.source && !error.message) return undefined;
  const message = error.message ?? 'No details provided.';
  return error.source ? `(${error.source}) ${message}` : message;
}

function hasTag(tags: string[] | undefined, tag: string): boolean {
  if (!tags) return false;
  const lower = tag.toLowerCase();
  return tags.some((t) => t.toLowerCase() === lower);
}

function formatHttpStatus(status: number | undefined): string {
  if (status === undefined) return '-';
  const s = String(status);
  if (status >= 200 && status < 300) return chalk.green(s);
  if (status >= 300 && status < 400) return chalk.yellow(s);
  return chalk.red(s);
}

/** Dollar value from either price-amount wire shape (old bare number | new
 *  {value, currency}) — see `PriceAmount` in api/types. */
function amountValue(a: PriceAmount | undefined): number | undefined {
  if (a == null) return undefined;
  return typeof a === 'number' ? a : a.value;
}

/** "minute", "5 minutes", "month" — human unit from a {unit, count} period. */
function unitLabel(p?: { unit: string; count: number }): string {
  if (!p) return 'unit';
  const u = p.unit.toLowerCase();
  return p.count === 1 ? u : `${p.count} ${u}s`;
}

function formatPriceCompact(p: Price): string {
  const amt = amountValue(p.amount);
  if (amt == null) return chalk.gray('n/a');
  switch (p.type) {
    case 'PER_CALL':
      return `$${amt}/call`;
    case 'PER_RESULT': {
      const flat = amountValue(p.flatFee);
      return `$${amt}/result${flat ? ` + $${flat} flat` : ''}`;
    }
    case 'BY_PERIOD':
      return `$${amt}/${unitLabel(p.period)}`;
    case 'METERED':
      return `$${amt}/${unitLabel(p.per)}`;
    case 'PER_UNIT_MATRIX':
      // `amount` carries the default/"from" price; the full table rides on
      // selectors/variants.
      return `from $${amt}`;
    default:
      return `$${amt}`;
  }
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Render an ISO timestamp for display: local date AND time. Including the
 * time is what makes local-timezone rendering unambiguous — a date-only
 * render of a UTC timestamp silently shifts the calendar day for anyone
 * west of UTC (e.g. `2026-07-14T02:00Z` showed as "Jul 13, 2026").
 *
 * `new Date(garbage)` never throws — it yields an Invalid Date — so the
 * guard is `Number.isNaN(getTime())` (a try/catch here is dead code);
 * unparseable input falls back to the raw string.
 *
 * Exported for tests.
 */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
