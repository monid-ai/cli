import { createWriteStream, renameSync, rmSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import chalk from 'chalk';
import { WEB_BASE_URL } from '../config/constants.js';
import { renderTable } from './table.js';
import { statusBadge, healthBadge, price as formatPrice } from './colors.js';
import type {
  BalanceResponse,
  ControlSnapshot,
  DiscoverResponse,
  EndpointInput,
  EndpointMetrics,
  InspectResponse,
  NestedPrice,
  Price,
  PriceAmount,
  PriceVariant,
  PriceWhen,
  Resource,
  ResourceEvent,
  ResourceEventsResponse,
  ResourceExternalJoin,
  ResourceListResponse,
  ResourceReleaseResponse,
  ResourceWithExternal,
  RunControl,
  RunError,
  ProviderResponse,
  RunDetailResponse,
  RunsListResponse,
  WhoamiResponse,
  PromoCodesListResponse,
  RedeemPromoCodeResponse,
} from '../api/types.js';
import { resourceStateBadge } from './colors.js';
import type { CredentialKey } from '../config/types.js';

// --- Discover ---

export function formatDiscoverResults(data: DiscoverResponse): void {
  if (data.results.length === 0) {
    console.log(chalk.gray('No results found.'));
    return;
  }

  // ONE `Health` column, not a status column plus a latency column. The two
  // facts answer the same question ("can I rely on this, and what will it
  // cost me in time?"), and splitting them spent ~20 chars of width to put a
  // gap between them. `Health` matches the section name `inspect` prints, so
  // the same concept reads under the same word on both surfaces.
  //
  // It sits at the end: it is narrow and often empty, so the ragged
  // whitespace stays on one edge instead of punching a hole through the
  // middle of the table.
  const headers = [
    'Provider',
    'Endpoint',
    'Price',
    'Description',
    'Health',
  ];
  const rows = data.results.map((r) => [
    r.provider,
    r.endpoint,
    formatPriceCompact(r.price),
    truncate(r.description, 50),
    formatHealthCell(r.metrics),
  ]);

  renderTable(headers, rows);

  formatHints(data.hints ?? data.usage);
}

// --- Inspect ---

/**
 * Render a price gate (`when`) as `key=value, key=value`.
 *
 * The wire OMITS `when` on an ungated tier or cell — one that always applies
 * and is metered by its `selector` alone. `Object.entries(undefined)` throws,
 * so an ungated tier used to abort the whole `inspect` render; it now yields
 * an empty string and callers drop the clause.
 */
function formatPriceWhen(when: PriceWhen | undefined): string {
  return Object.entries(when ?? {})
    .map(([k, val]) => `${k}=${val}`)
    .join(', ');
}

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

  if (data.summary) {
    console.log();
    console.log(chalk.bold('Summary'));
    console.log(`  ${data.summary}`);
  }

  console.log();
  console.log(chalk.bold('Pricing'));
  formatInspectPricing(data.price);

  formatHealth(data.metrics);

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

/** Render the Pricing body. A missing price (null/undefined) is tolerated. */
function formatInspectPricing(price: Price | null | undefined): void {
  if (!price) {
    console.log('  Not available.');
    return;
  }
  console.log(
    `  Type:   ${price.type}\n` +
    `  Amount: ${formatPriceCompact(price)}`,
  );
  const flatFee = amountValue(price.flatFee);
  if (flatFee) {
    console.log(`  Flat fee: $${flatFee}`);
  }
  if (price.type === 'PER_UNIT_MATRIX' && price.variants?.length) {
    console.log(`  Variants: ${price.variants.length} (price varies by input)`);
    for (const v of price.variants) {
      const gate = formatPriceWhen(v.when);
      const label = v.label ? ` ${chalk.gray(`(${v.label})`)}` : '';
      console.log(`    - ${gate ? `${gate}: ` : ''}${formatAmount(variantCell(v))}${label}`);
    }
  }
  if (price.type === 'TIERED') {
    // Always-on default + add-on tiers (SUMMED on top of it). A tier with
    // a `when` gate applies when the gate matches; an ungated tier always
    // applies and is metered by its `selector`.
    if (price.default) {
      console.log(`  Base:   ${formatAmount(price.default)} (always)`);
    }
    for (const t of price.tiers ?? []) {
      const gate = formatPriceWhen(t.when);
      console.log(
        `    + ${t.label}: ${formatAmount(t.price)}${gate ? ` when ${gate}` : ''}`,
      );
    }
  }

  if (price.notes?.length) {
    console.log('  Notes:');
    price.notes.forEach((n) => {
      console.log(`    - ${n}`);
    });
  }
}

// --- Endpoint Health ---

/**
 * Render the `Health` section of `inspect`.
 *
 * The section is skipped only when there is no `metrics` block at all —
 * absence means "no data", and inventing a reassuring default would misreport
 * an unmeasured endpoint as fine. Otherwise `Status:` always prints whatever
 * verdict the server sent, `unknown` included: on a detail view the reader has
 * asked about this one endpoint, so "we don't know" is an answer, and a
 * missing line would be indistinguishable from a rendering bug.
 *
 * `Run time:` is omitted without percentiles, and renders only the ones
 * actually present (`p50` and `p95` are independently optional). It is
 * independent of the verdict, so an `unknown`-but-timed endpoint still shows
 * its run time.
 *
 * Exported for tests.
 */
export function formatHealth(metrics: EndpointMetrics | undefined): void {
  if (!metrics) return;

  const status = healthBadge(metrics.status);
  const runTime = formatRunTime(metrics.runTimeMs);
  if (!status && !runTime) return;

  console.log();
  console.log(chalk.bold('Health'));
  if (status) console.log(`  Status:   ${status}`);
  if (runTime) console.log(`  Run time: ${runTime}`);
}

/**
 * "healthy 4.4s" — the single-cell health summary for the discover table.
 *
 * ONE fact per dimension: the verdict, plus the MEDIAN run time. The tail
 * (`p95`) is deliberately not here. Two durations in a scan column have to be
 * read positionally to tell median from tail, and getting that backwards
 * inverts the decision they inform (`--wait` vs fire-and-poll) — a labelled
 * two-value render is what `inspect` is for.
 *
 * Both halves are independently optional, and either may be missing without
 * the other:
 *   - verdict + median  ⇒ `healthy 4.4s`
 *   - verdict only      ⇒ `healthy`
 *   - median only       ⇒ `4.4s`   (status was `unknown`/absent)
 *   - neither           ⇒ `''`     (blank cell, never a placeholder)
 *
 * The duration is left UNSTYLED. It was briefly dimmed to keep the verdict
 * primary, but `chalk.gray` is bright-black (SGR 90), which is close to
 * unreadable on the dark terminal themes most people use — and an unreadable
 * number is worse than a slightly less emphatic one. The colored verdict next
 * to a plain duration already carries the hierarchy.
 *
 * Exported for tests.
 */
export function formatHealthCell(metrics: EndpointMetrics | undefined): string {
  if (!metrics) return '';
  const status = healthBadge(metrics.status);
  const p50 = metrics.runTimeMs?.p50;
  const typical = p50 === undefined ? '' : formatDuration(p50);
  if (!status) return typical;
  if (!typical) return status;
  return `${status} ${typical}`;
}

/**
 * "4.4s typical · 6.1s tail" — the percentiles with plain-language labels
 * instead of `p50`/`p95`, which say nothing to a reader who doesn't already
 * know the convention. Returns `undefined` when neither is present so the
 * caller can skip the line.
 */
function formatRunTime(runTimeMs: EndpointMetrics['runTimeMs']): string | undefined {
  if (!runTimeMs) return undefined;
  const parts: string[] = [];
  if (runTimeMs.p50 !== undefined) {
    parts.push(`${formatDuration(runTimeMs.p50)} typical`);
  }
  if (runTimeMs.p95 !== undefined) {
    parts.push(`${formatDuration(runTimeMs.p95)} tail`);
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/**
 * Human-readable duration from milliseconds.
 *
 * The catalog spans roughly 700ms to 450s, so a raw ms number is unreadable at
 * the top of that range (`447031ms`) and a seconds-only render is imprecise at
 * the bottom. Three bands: sub-second stays in ms, under a minute gets one
 * decimal second, above that switches to minutes.
 *
 * Exported for tests.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return chalk.gray('n/a');
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${trimZero(ms / 1000)}s`;
  return `${trimZero(ms / 60_000)}m`;
}

/** One decimal, but `4.0` renders as `4` — the trailing zero is noise. */
function trimZero(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '');
}

// --- Run Detail ---

/** Where a run's body lives on the response. */
export type OutputField = 'data' | 'error' | 'output';

/**
 * The run's body and the field it came from: provider data, then its error
 * body, then stored run output. The ONE place this priority lives; the file
 * `-o` writes and what `--json` trims from stdout both follow it.
 */
export function resolveOutputSource(
  data: Pick<RunDetailResponse, 'providerResponse' | 'output'>,
): { field: OutputField; body: Record<string, unknown> } | undefined {
  const pr = data.providerResponse;
  if (pr?.data != null) return { field: 'data', body: pr.data };
  if (pr?.error != null) return { field: 'error', body: pr.error };
  if (data.output != null) return { field: 'output', body: data.output };
  return undefined;
}

/** The run's body (see `resolveOutputSource`), or undefined when there is none. */
export function resolveOutput(
  data: Pick<RunDetailResponse, 'providerResponse' | 'output'>,
): Record<string, unknown> | undefined {
  return resolveOutputSource(data)?.body;
}

/** A value the service would accept as an ISO timestamp. */
function isDate(v: unknown): v is string {
  return typeof v === 'string' && Number.isFinite(Date.parse(v));
}

/** Monid's file store: sfs.monid.ai in prod, sfs.<env>.monid.ai elsewhere. */
function isSfsLink(link: string): boolean {
  try {
    const { protocol, hostname } = new URL(link);
    return (
      protocol === 'https:' &&
      (hostname === 'sfs.monid.ai' || (hostname.startsWith('sfs.') && hostname.endsWith('.monid.ai')))
    );
  } catch {
    return false;
  }
}

const OVERFLOW_KEYS = ['download_link', 'content_type', 'link_expires_at', 'file_expires_at'];

/**
 * When a provider response is too large to return inline, the service stores
 * it and replaces the WHOLE output with one key (`data`, or `file` for
 * smolmachine downloads) holding a strict envelope:
 * `{ download_link, content_type, link_expires_at, file_expires_at? }`.
 * Returns the link for exactly that shape on our file store, else undefined.
 *
 * File results (an `image`/`audio`/`video` envelope next to provider fields,
 * or a provider-hosted URL) are not overflow: they are the result itself and
 * stay as JSON.
 *
 * Exported for tests.
 */
export function findOverflowLink(output: Record<string, unknown> | undefined): string | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined;
  const values = Object.values(output);
  if (values.length !== 1) return undefined;
  const value = values[0];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const env = value as Record<string, unknown>;
  if (!Object.keys(env).every((k) => OVERFLOW_KEYS.includes(k))) return undefined;
  if (typeof env.content_type !== 'string' || !isDate(env.link_expires_at)) return undefined;
  if (env.file_expires_at !== undefined && !isDate(env.file_expires_at)) return undefined;
  return typeof env.download_link === 'string' && isSfsLink(env.download_link) ? env.download_link : undefined;
}

/** The body could not be downloaded; the file holds its download link instead. */
export class OutputDownloadError extends Error {}

/** Generous: a body can be tens of MB. A hung download must not hang the CLI. */
const DOWNLOAD_TIMEOUT_MS = 300_000;

/** Write the output to `path`: the body itself, downloaded when it overflowed. */
async function saveRunOutput(output: Record<string, unknown>, path: string): Promise<void> {
  const link = findOverflowLink(output);
  if (!link) {
    writeFileSync(path, JSON.stringify(output, null, 2));
    return;
  }
  const part = `${path}.part`;
  try {
    // Plain fetch, not the API client: the link is its own credential and
    // the API key must not leave the API host.
    const res = await fetch(link, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as NodeReadableStream), createWriteStream(part));
    renameSync(part, path);
  } catch (err) {
    rmSync(part, { force: true });
    // Keep the link so nothing is lost; `monid runs get` mints a fresh one.
    writeFileSync(path, JSON.stringify(output, null, 2));
    const reason = err instanceof Error ? err.message : String(err);
    throw new OutputDownloadError(
      `Couldn't download the response body (${reason}); ${path} holds its download link instead.`,
    );
  }
}

/**
 * Write resolved output to `path`, or explain its absence. Suppress notices in
 * JSON mode. A failed download prints a warning and exits 1 in human mode; in
 * JSON mode it throws for `writeRunOutputJson` to report.
 */
export async function writeRunOutput(
  data: Pick<RunDetailResponse, 'providerResponse' | 'output' | 'status'>,
  path: string,
  json?: boolean,
): Promise<void> {
  const output = resolveOutput(data);
  if (!output) {
    if (!json) {
      console.log(chalk.dim(`No output to write to ${path} (status: ${data.status}).`));
    }
    return;
  }
  try {
    await saveRunOutput(output, path);
  } catch (err) {
    if (json || !(err instanceof OutputDownloadError)) throw err;
    console.log(chalk.yellow(err.message));
    process.exitCode = 1;
    return;
  }
  if (!json) console.log(`Output written to ${path}`);
}

/**
 * JSON-mode write: on failure, report the error on the response instead of
 * throwing, so stdout stays one JSON document that still carries the run ID.
 *
 * On success `outputFile` names where the body was saved, and a successful
 * body (it can be many megabytes) is left out of the returned document;
 * everything else on the run (ID, status, cost, HTTP status) stays. A
 * provider error body is kept: it is small, and it is what an agent reads to
 * decide what to do next. When there was no output to save, the response is
 * returned unchanged.
 */
export async function writeRunOutputJson<T extends Pick<RunDetailResponse, 'providerResponse' | 'output' | 'status'>>(
  data: T,
  path: string,
): Promise<T | SavedRunJson<T> | (T & { outputError: { path: string; message: string } })> {
  try {
    await writeRunOutput(data, path, true);
  } catch (err) {
    process.exitCode = 1;
    const message = err instanceof Error ? err.message : String(err);
    return { ...data, outputError: { path, message } };
  }
  const source = resolveOutputSource(data);
  if (!source) return data;

  const { output, providerResponse, ...rest } = data;
  switch (source.field) {
    case 'output':
      return { ...rest, providerResponse, outputFile: path };
    case 'error':
      return { ...rest, output, providerResponse, outputFile: path };
    case 'data': {
      const { data: _saved, ...pr } = providerResponse as ProviderResponse;
      return { ...rest, output, providerResponse: pr, outputFile: path };
    }
  }
}

/**
 * The `--json` document after `-o` saved the body: `outputFile` is set, and
 * the saved success body (`output`, or the legacy `providerResponse.data`)
 * may be absent. A provider error body stays.
 */
export type SavedRunJson<T extends Pick<RunDetailResponse, 'providerResponse' | 'output'>> =
  Omit<T, 'output' | 'providerResponse'> & {
    output?: T['output'];
    providerResponse?: Omit<ProviderResponse, 'data'>;
    outputFile: string;
  };

export function formatRunDetail(data: RunDetailResponse): void {
  console.log();
  console.log(chalk.bold('Run Details'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  Run ID:   ${data.runId}`);
  console.log(`  Provider: ${data.providerName || data.provider}`);
  console.log(`  Endpoint: ${data.endpoint}`);
  console.log(`  Status:   ${statusBadge(data.status)}`);

  // The API serializes EVERY terminal run's providerResponse, and a run that
  // never got a provider answer (TIMED_OUT, FAILED, BLOCKED) arrives as `{}`,
  // which is truthy. Key on the status number, not the object.
  const status = data.providerResponse?.httpStatus;
  if (typeof status === 'number') {
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
    chalk.bold(r.runId),
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
  // Never display a negative balance — $0.00 already means "top up".
  const value = Math.max(0, data.balance.value);
  const color = value > 0 ? chalk.green : chalk.yellow;
  console.log();
  console.log(`  Balance: ${color(`$${value.toFixed(2)}`)} ${data.balance.currency}`);
  if (data.held && data.held.value > 0) {
    console.log(`  Held:    $${data.held.value.toFixed(2)} ${chalk.gray('(reserved by runs and resources in progress)')}`);
  }
  // At $0, say how to fund the wallet. `topup.stripe` is only sent to a key
  // that may create a checkout session; `dashboard` may be absent, so fall
  // back to the web app for this environment.
  if (value <= 0 && (data.topup?.dashboard || data.topup?.stripe)) {
    const dashboard = data.topup.dashboard ?? `${WEB_BASE_URL}/wallet`;
    console.log(
      chalk.gray(
        `  Top up at ${dashboard}${data.topup.stripe ? ' or run: monid topup -a <AMOUNT>' : ''}`,
      ),
    );
  }
  formatHints(data.hints ?? data.usage);
  console.log();
}

// --- Promo codes ---

/** The label a redeemed code shows: the signup credit by name. */
export function promoCodeLabel(kind: string, code: string): string {
  return kind === 'signup_credit' ? `Signup credit (${code})` : code;
}

export function formatPromoCodesList(data: PromoCodesListResponse): void {
  console.log();
  if (data.items.length === 0) {
    console.log(chalk.gray('  No promo codes redeemed yet (no signup credit either).'));
    console.log();
    return;
  }
  const headers = ['Code', 'Amount', 'Redeemed'];
  const rows = data.items.map((p) => [
    chalk.bold(promoCodeLabel(p.kind, p.code)),
    chalk.green(`$${p.amount.toFixed(2)}`),
    formatDate(p.redeemedAt),
  ]);
  renderTable(headers, rows);
  if (!data.items.some((p) => p.kind === 'signup_credit')) {
    console.log(chalk.gray('  No signup credit on this workspace yet.'));
  }
  if (data.cursor) {
    console.log(chalk.gray(`More results available. Use --cursor ${data.cursor}`));
  }
  console.log();
}

export function formatRedeemPromoCode(
  code: string,
  data: RedeemPromoCodeResponse,
): void {
  console.log();
  console.log(`  Redeemed ${chalk.bold(code)}: ${chalk.green(`+$${data.amount.toFixed(2)}`)} ${data.currency}`);
  console.log(`  Balance:  ${chalk.green(`$${data.balance.value.toFixed(2)}`)} ${data.balance.currency}`);
  console.log();
}

// --- Whoami ---

export function formatWhoami(data: WhoamiResponse): void {
  console.log();
  console.log(chalk.bold('User'));
  console.log(`  ID:       ${data.user.userId}`);
  if (data.user.username) console.log(`  Username: ${data.user.username}`);
  if (data.user.email) console.log(`  Email:    ${data.user.email}`);

  if (data.workspace) {
    console.log();
    console.log(chalk.bold('Workspace'));
    console.log(`  ID:   ${data.workspace.workspaceId}`);
    if (data.workspace.name) console.log(`  Name: ${data.workspace.name}`);
    if (data.workspace.slug) console.log(`  Slug: ${data.workspace.slug}`);
  } else {
    console.log();
    console.log(chalk.gray('  Not part of a workspace.'));
  }

  formatHints(data.hints ?? data.usage);
  console.log();
}

// --- Resources ---

export function formatResourcesList(data: ResourceListResponse): void {
  if (data.items.length === 0) {
    console.log(chalk.gray('No resources found.'));
    return;
  }

  const headers = ['Resource ID', 'Provider', 'Type', 'Identifier', 'State', 'Created'];
  const rows = data.items.map((r) => [
    chalk.bold(r.resourceId),
    r.provider,
    r.resourceType,
    r.identifier,
    resourceStateBadge(r.state),
    formatDate(r.createdAt),
  ]);

  renderTable(headers, rows);

  if (data.cursor) {
    console.log(chalk.gray(`More results available. Use --cursor ${data.cursor}`));
  }

  formatHints(data.hints ?? data.usage);
}

export function formatResourceDetail(data: ResourceWithExternal): void {
  console.log();
  console.log(chalk.bold('Resource'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  Resource ID: ${data.resourceId}`);
  console.log(`  Provider:    ${data.provider}`);
  console.log(`  Type:        ${data.resourceType}`);
  console.log(`  Identifier:  ${data.identifier}`);
  console.log(`  State:       ${resourceStateBadge(data.state)}`);
  if (data.phoneNumber) console.log(`  Phone:       ${data.phoneNumber}`);
  if (data.country) console.log(`  Country:     ${data.country}`);
  if (data.numberType) console.log(`  Number Type: ${data.numberType}`);
  console.log(`  Created:     ${formatDate(data.createdAt)}`);
  console.log(`  Updated:     ${formatDate(data.updatedAt)}`);
  if (data.releasedAt) {
    console.log(`  Released:    ${formatDate(data.releasedAt)}`);
    if (data.releaseReason) console.log(`  Reason:      ${data.releaseReason}`);
  }

  if (data.renewal) {
    console.log();
    console.log(chalk.bold('Renewal'));
    console.log(`  Price:        ${formatPriceCompact(data.renewal.price)}`);
    console.log(`  Cycle:        ${data.renewal.cycle}`);
    console.log(`  Period Start: ${formatDate(data.renewal.currentPeriodStart)}`);
    console.log(`  Period End:   ${formatDate(data.renewal.currentPeriodEnd)}`);
    console.log(`  Next Attempt: ${formatDate(data.renewal.renewAttemptAt)}`);
    if (data.renewal.cancelledAt) {
      console.log(`  Cancelled:    ${formatDate(data.renewal.cancelledAt)}`);
    }
    if (data.renewal.lastAttempt) {
      const la = data.renewal.lastAttempt;
      const outcome =
        la.outcome === 'SUCCEEDED' ? chalk.green(la.outcome) : chalk.red(la.outcome);
      console.log(`  Last Attempt: ${outcome} @ ${formatDate(la.at)}${la.reason ? ` (${la.reason})` : ''}`);
    }
  }

  if (data.externalDetails?.length) {
    console.log();
    console.log(chalk.bold('External Links'));
    for (const link of data.externalDetails) {
      formatExternalLink(link);
    }
  }

  formatHints(data.hints ?? data.usage);
  console.log();
}

function formatExternalLink(link: ResourceExternalJoin): void {
  const title = link.label ? `${link.displayName} (${link.label})` : link.displayName;
  console.log(`  ${chalk.gray(link.kind)} — ${title}`);
  if (link.error) {
    console.log(`    ${chalk.red(`Failed to fetch: ${link.error}`)}`);
    return;
  }
  if (link.data && Object.keys(link.data).length > 0) {
    const json = JSON.stringify(link.data, null, 2)
      .split('\n')
      .map((l) => `    ${l}`)
      .join('\n');
    console.log(json);
  }
}

export function formatResourceEvents(data: ResourceEventsResponse): void {
  if (data.items.length === 0) {
    console.log(chalk.gray('No events found.'));
    return;
  }

  const headers = ['When', 'Type', 'Cycle', 'Amount', 'Reason'];
  const rows = data.items.map((e: ResourceEvent) => [
    formatDate(e.at),
    e.type,
    e.cycle != null ? String(e.cycle) : '-',
    e.amount ? `$${e.amount.value} ${e.amount.currency}` : '-',
    e.reason ?? '-',
  ]);

  renderTable(headers, rows);

  if (data.cursor) {
    console.log(chalk.gray(`More results available. Use --cursor ${data.cursor}`));
  }

  formatHints(data.hints ?? data.usage);
}

export function formatResourceRelease(data: ResourceReleaseResponse): void {
  console.log();
  console.log(`  Resource: ${data.resourceId}`);
  console.log(`  State:    ${resourceStateBadge(data.state)}`);
  console.log(`  ${data.message}`);
  formatHints(data.hints ?? data.usage);
  console.log();
}

// --- Structured Input ---

/** Check whether a value is a non-empty object (has at least one key). */
function isNonEmpty(obj: Record<string, unknown> | null | undefined): obj is Record<string, unknown> {
  return obj != null && typeof obj === 'object' && Object.keys(obj).length > 0;
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

/**
 * Format a control amount. The API sends control amounts as plain USD
 * numbers; anything else (missing, or an unexpected shape) renders as '-'
 * rather than crashing the whole run render. Four decimals, like run
 * prices: many runs cost under a cent.
 */
function formatUsd(n: unknown): string {
  return typeof n === 'number' && Number.isFinite(n)
    ? `$${Math.max(0, n).toFixed(4)}`
    : '-';
}

function formatRunControl(control: RunControl): void {
  console.log(`  ${chalk.gray('Control ID:')} ${control.controlId}`);
  formatControlSnapshot(control.snapshot);
  if (control.requiredAmount !== undefined) {
    console.log(`    ${chalk.gray('Required:')}  ${formatUsd(control.requiredAmount)}`);
  }
  console.log();
}

function formatControlSnapshot(snapshot: ControlSnapshot): void {
  switch (snapshot.type) {
    case 'WORKSPACE_BUDGET':
      console.log(`    ${chalk.gray('Type:')}      Workspace Budget`);
      console.log(`    ${chalk.gray('Period:')}    ${snapshot.period}`);
      console.log(`    ${chalk.gray('Window:')}    ${formatDate(snapshot.windowStart)}`);
      console.log(`    ${chalk.gray('Limit:')}     ${formatUsd(snapshot.limitAmount)}`);
      console.log(`    ${chalk.gray('Available:')} ${formatUsd(snapshot.availableAmount)}`);
      console.log(`    ${chalk.gray('Held:')}      ${formatUsd(snapshot.heldAmount)}`);
      console.log(`    ${chalk.gray('Spent:')}     ${formatUsd(snapshot.spentAmount)}`);
      break;
    case 'WORKSPACE_RUN_CAP':
      console.log(`    ${chalk.gray('Type:')}      Workspace Run Cap`);
      console.log(`    ${chalk.gray('Limit:')}     ${formatUsd(snapshot.limitAmount)}`);
      break;
    case 'WORKSPACE_WALLET_BALANCE':
      console.log(`    ${chalk.gray('Type:')}      Wallet Balance`);
      console.log(`    ${chalk.gray('Balance:')}   ${formatUsd(snapshot.limitAmount)}`);
      console.log(`    ${chalk.gray('Held:')}      ${formatUsd(snapshot.heldAmount)}`);
      console.log(`    ${chalk.gray('Available:')} ${formatUsd(snapshot.availableAmount)}`);
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

function formatHttpStatus(status: number | undefined): string {
  if (status === undefined) return '-';
  const s = String(status);
  if (status >= 200 && status < 300) return chalk.green(s);
  if (status >= 300 && status < 400) return chalk.yellow(s);
  return chalk.red(s);
}

/**
 * Detect a nested price sub-expression carried inside a `PriceAmount`.
 * A `PriceAmount` may be a bare number, a `{value, currency}` money object, or
 * a nested price `{ type, amount, per? }`. This narrows to the last case.
 */
function isNestedPrice(a: PriceAmount): a is NestedPrice {
  return (
    typeof a === 'object' &&
    a !== null &&
    'type' in a &&
    'amount' in a
  );
}

/**
 * Extract a leaf dollar value from any `PriceAmount` shape, recursing through
 * nested price expressions (e.g. PER_UNIT_MATRIX → PER_TOKEN → {value}).
 * Returns `undefined` when no numeric leaf can be found (unknown/future shape).
 */
function amountValue(a: PriceAmount | undefined): number | undefined {
  if (a == null) return undefined;
  if (typeof a === 'number') return a;
  if (isNestedPrice(a)) return amountValue(a.amount);
  if (typeof a.value === 'number') return a.value;
  return undefined;
}

/** "1M", "1.5K", "1000" — compact human count for a per-unit divisor. */
function compactCount(n: number): string {
  if (n >= 1_000_000 && n % 1_000_000 === 0) return `${n / 1_000_000}M`;
  if (n >= 1_000 && n % 1_000 === 0) return `${n / 1_000}K`;
  return String(n);
}

/**
 * Render any `PriceAmount` to a compact string, recursing into nested price
 * expressions (LEAF prices on the current wire — the SAME shape for matrix
 * cells, TIERED tiers, and the top-level `default` of both):
 *  - PER_TOKEN → `$5.6 / 1M tokens` (numeric `per` divisor + `unit`)
 *  - METERED   → `$0.15 / minute` ({unit,count} `per`)
 *  - PER_RESULT → `$0.001 / result`
 *  - PER_CALL / bare money → `$0.28`
 * Degrades gracefully — never `[object Object]`.
 */
function formatAmount(a: PriceAmount | undefined): string {
  if (a == null) return chalk.gray('n/a');
  if (typeof a === 'number') return `$${a}`;
  if (isNestedPrice(a)) {
    const inner = formatAmount(a.amount);
    if (typeof a.per === 'number') {
      const unit = nestedUnitLabel(a);
      return `${inner} / ${compactCount(a.per)}${unit ? ` ${unit}` : ''}`;
    }
    if (a.per != null) {
      // {unit,count} quantum (a METERED leaf).
      return `${inner} / ${unitLabel(a.per)}`;
    }
    if (a.type === 'PER_RESULT') return `${inner} / result`;
    return inner;
  }
  // Plain { value, currency } money leaf.
  return typeof a.value === 'number' ? `$${a.value}` : chalk.gray('n/a');
}

/** Map a nested per-unit price to its counted noun (best effort). */
function nestedUnitLabel(a: NestedPrice): string {
  switch (a.type) {
    case 'PER_TOKEN':
      return a.unit === 'character' ? 'characters' : 'tokens';
    default:
      return '';
  }
}

/**
 * The per-unit suffix (e.g. ` / 1M tokens`) for a `PriceAmount`, or `''` when
 * the amount is not a nested per-unit price. Used to append a shared unit after
 * a min–max range so we render `$4-$7 / 1M tokens` rather than repeating it.
 */
function perUnitSuffix(a: PriceAmount | undefined): string {
  if (a == null || typeof a === 'number' || !isNestedPrice(a)) return '';
  if (typeof a.per !== 'number') return '';
  const unit = nestedUnitLabel(a);
  return ` / ${compactCount(a.per)}${unit ? ` ${unit}` : ''}`;
}

/** A matrix variant's cell — current wire `price`, old wire `amount`. */
function variantCell(v: PriceVariant): PriceAmount | undefined {
  return v.price ?? v.amount;
}

/**
 * Render a `PER_UNIT_MATRIX` as a price *range* across its variants, e.g.
 * `$4-$7 / 1M tokens`. Falls back to a single amount when there are 0–1 distinct
 * prices. The current wire has no matrix `default` (every rate is a published
 * row); older backends sent one, so it is still accepted as a last resort
 * alongside the top-level `amount`. Degrades to `formatAmount(...)` if no
 * numeric leaves can be extracted.
 */
function formatMatrixRange(p: Price): string {
  const base: PriceAmount | undefined = p.default ?? p.amount;
  const variantCells = (p.variants ?? [])
    .map(variantCell)
    .filter((a): a is PriceAmount => a != null);
  // Prefer variant cells for the range; fall back to the default/base.
  const amounts = variantCells.length > 0
    ? variantCells
    : base != null
    ? [base]
    : [];

  const values = amounts
    .map((a) => amountValue(a))
    .filter((n): n is number => n != null);

  if (values.length === 0) {
    // No numeric leaves — best effort on the default/base amount.
    return `from ${formatAmount(base)}`;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  // Unit suffix comes from any priced cell (they share the divisor/type in
  // practice); prefer the first variant cell, else the default leaf.
  const suffix = perUnitSuffix(amounts[0]) || perUnitSuffix(p.default);

  if (min === max) {
    return `$${min}${suffix}`;
  }
  return `$${min}-$${max}${suffix}`;
}

/** "minute", "5 minutes", "month" — human unit from a {unit, count} period. */
function unitLabel(p?: { unit: string; count: number }): string {
  if (!p) return 'unit';
  const u = p.unit.toLowerCase();
  return p.count === 1 ? u : `${p.count} ${u}s`;
}

/**
 * Render a `TIERED` price compactly — DEFAULT-driven: the unit word comes
 * from the default leaf's TYPE (`$0.001/call`, `$0.001/result`, a token
 * rate…), prefixed `from` when the charge can grow (a quantity-billed
 * default, or gated add-on tiers). No default → `varies`.
 */
function formatTieredCompact(p: Price): string {
  const d = p.default;
  if (!d) return chalk.gray('varies');
  const canGrow = d.type !== 'PER_CALL' || (p.tiers?.length ?? 0) > 0;
  let base: string;
  switch (d.type) {
    case 'PER_CALL':
      base = `${formatAmount(d.amount)}/call`;
      break;
    case 'PER_RESULT':
      base = `${formatAmount(d.amount)}/result`;
      break;
    case 'METERED':
      base = `${formatAmount(d.amount)}/${
        unitLabel(typeof d.per === 'number' ? undefined : d.per)
      }`;
      break;
    default:
      // PER_TOKEN (and future leaves) render via the leaf renderer.
      base = formatAmount(d);
  }
  return canGrow ? `from ${base}` : base;
}

export function formatPriceCompact(p: Price): string {
  // Render the (possibly nested) amount once; reuse across price types.
  const amtStr = formatAmount(p.amount);
  if (p.type !== 'TIERED' && amtStr === chalk.gray('n/a')) return amtStr;
  switch (p.type) {
    case 'PER_CALL':
      return `${amtStr}/call`;
    case 'PER_RESULT': {
      const flat = amountValue(p.flatFee);
      return `${amtStr}/result${flat ? ` + $${flat} flat` : ''}`;
    }
    case 'BY_PERIOD':
      return `${amtStr}/${unitLabel(p.period)}`;
    case 'METERED':
      return `${amtStr}/${unitLabel(p.per)}`;
    case 'PER_UNIT_MATRIX':
      // Render as a price range across variants, e.g. `$4-$7 / 1M tokens`.
      // `default` carries the fallback leaf; the full table rides on
      // selectors/variants.
      return formatMatrixRange(p);
    case 'TIERED':
      return formatTieredCompact(p);
    default:
      return amtStr;
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
