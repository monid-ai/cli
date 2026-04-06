import chalk from 'chalk';
import { renderTable } from './table.js';
import { statusBadge, price as formatPrice } from './colors.js';
import type {
  DiscoverResponse,
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

  const headers = ['Provider', 'Endpoint', 'Price', 'Description'];
  const rows = data.results.map((r) => [
    r.provider,
    r.endpoint,
    formatPriceCompact(r.price),
    truncate(r.description, 50),
  ]);

  renderTable(headers, rows);
}

// --- Inspect ---

export function formatInspectResult(data: InspectResponse): void {
  console.log();

  console.log(chalk.bold('Provider'));
  console.log(`  ${data.providerName} (${data.provider})`);
  console.log();

  console.log(chalk.bold('Endpoint'));
  console.log(`  ${data.endpoint}`);

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

  if (data.inputSchema) {
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

export function formatRunDetail(data: RunDetailResponse): void {
  console.log();
  console.log(chalk.bold('Run Details'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  Run ID:   ${data.runId}`);
  console.log(`  Provider: ${data.providerName || data.provider}`);
  console.log(`  Endpoint: ${data.endpoint}`);
  console.log(`  Status:   ${statusBadge(data.status)}`);

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

  if (data.output) {
    console.log();
    console.log(chalk.bold('Output'));
    console.log(JSON.stringify(data.output, null, 2));
  }

  console.log();
}

// --- Runs List ---

export function formatRunsList(data: RunsListResponse): void {
  if (data.items.length === 0) {
    console.log(chalk.gray('No runs found.'));
    return;
  }

  const headers = ['Run ID', 'Provider', 'Endpoint', 'Status', 'Cost', 'Created'];
  const rows = data.items.map((r) => [
    r.runId.slice(0, 12) + '...',
    r.providerName || r.provider,
    r.endpoint,
    r.status,
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

// --- Helpers ---

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
