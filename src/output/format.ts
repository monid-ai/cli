import chalk from 'chalk';
import { renderTable } from './table.js';
import { statusBadge, price as formatPrice } from './colors.js';
import type {
  DiscoverResponse,
  EndpointInput,
  InspectResponse,
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
}

// --- Inspect ---

export function formatInspectResult(data: InspectResponse): void {
  console.log();

  console.log(chalk.bold('Provider'));
  console.log(`  ${data.providerName} (${data.provider})`);
  console.log();

  console.log(chalk.bold('Endpoint'));
  console.log(`  ${data.endpoint}`);

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
  if (data.price.flatFee) {
    console.log(`  Flat fee: $${data.price.flatFee}`);
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

  if (data.usage) {
    console.log();
    console.log(chalk.bold('Usage'));
    console.log(`  ${chalk.gray('API:')} ${data.usage.api}`);
    console.log(`  ${chalk.gray('CLI:')} ${data.usage.cli}`);
  }

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

  if (data.cost) {
    console.log(`  Cost:     $${data.cost.value.toFixed(4)} ${data.cost.currency}`);
  }

  console.log(`  Created:  ${formatDate(data.createdAt)}`);
  if (data.completedAt) {
    console.log(`  Completed: ${formatDate(data.completedAt)}`);
  }

  if (data.error) {
    console.log();
    console.log(chalk.red(`  Error (${data.error.source}): ${data.error.message}`));
  }

  const output = resolveOutput(data);
  if (output) {
    console.log();
    console.log(chalk.bold('Output'));
    console.log(JSON.stringify(output, null, 2));
  }

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
    r.status,
    formatHttpStatus(r.providerResponse?.httpStatus),
    r.cost ? `$${r.cost.value.toFixed(4)}` : '-',
    formatDate(r.createdAt),
  ]);

  renderTable(headers, rows);

  if (data.cursor) {
    console.log(chalk.gray(`More results available. Use --cursor ${data.cursor}`));
  }
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

  const headers = ['Label', 'Key', 'Added At'];
  const rows = entries.map(([label, cred]) => [
    label,
    `${cred.prefix}*******`,
    formatDate(cred.added_at),
    label === activeLabel ? chalk.green('★') : '',
  ]);

  renderTable(headers, rows);
}

// --- Structured Input ---

/** Check whether a value is a non-empty object (has at least one key). */
function isNonEmpty(obj: Record<string, unknown> | undefined): obj is Record<string, unknown> {
  return obj !== undefined && Object.keys(obj).length > 0;
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

// --- Helpers ---

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

function formatPriceCompact(p: { type: string; amount: number; currency: string }): string {
  return `$${p.amount}/${p.type === 'PER_CALL' ? 'call' : 'result'}`;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}
