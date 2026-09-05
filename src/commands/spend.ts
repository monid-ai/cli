import { Command } from '@cliffy/command';
import { MonidAPI } from '../api/client.js';
import type { RunListItem, SpendBucket, SpendReport } from '../api/types.js';
import { ConfigManager } from '../config/manager.js';
import { handleError, MonidError } from '../utils/error.js';
import { printUpdateNotice, applyUpdateNote } from '../utils/update-check.js';
import { formatSpendReport } from '../output/format.js';
import { startSpinner, succeedSpinner, stopSpinner, updateSpinner } from '../output/spinner.js';

const PAGE_SIZE = 100;
const TOP_ENDPOINTS = 5;
const TOP_RUNS = 3;

export const spendCommand = new Command()
  .name('spend')
  .description('Summarize workspace spend by provider and endpoint.')
  .option('-j, --json', 'Output as JSON.')
  .action(async ({ json }) => {
    try {
      const config = new ConfigManager();
      const active = config.getActiveKey();
      if (!active) {
        throw new MonidError(
          'AUTH_FAILED',
          'No active API key. Run "monid keys add" to configure one.',
        );
      }

      const api = new MonidAPI({ apiKey: active.credential.key });

      if (!json) {
        startSpinner('Fetching runs...');
      }

      const items: RunListItem[] = [];
      let cursor: string | undefined;
      do {
        const page = await api.listRuns(PAGE_SIZE, cursor);
        items.push(...page.items);
        cursor = page.cursor ?? undefined;
        if (!json) updateSpinner(`Fetching runs... ${items.length}`);
      } while (cursor);

      const report = buildSpendReport(items);
      const updateInfo = await config.getUpdateInfo();

      if (json) {
        const output = updateInfo ? applyUpdateNote(report, updateInfo) : report;
        console.log(JSON.stringify(output, null, 2));
      } else {
        succeedSpinner(`Analyzed ${items.length} run(s)`);
        formatSpendReport(report);
        if (updateInfo) printUpdateNotice(updateInfo);
      }
    } catch (err) {
      stopSpinner();
      handleError(err, json);
    }
  });

/**
 * Aggregate the full runs list into a spend report. Items are expected
 * newest-first, as `/v1/runs` returns them.
 */
export function buildSpendReport(items: RunListItem[]): SpendReport {
  const providers = new Map<string, SpendBucket>();
  const endpoints = new Map<string, SpendBucket>();
  let spend = 0;
  let currency: string | undefined;
  let failedRuns = 0;
  let failedSpend = 0;

  for (const run of items) {
    const cost = run.cost?.value ?? 0;
    spend += cost;
    if (currency === undefined && run.cost) currency = run.cost.currency;

    const providerEntry = upsertBucket(providers, run.provider, {
      provider: run.provider,
      providerName: run.providerName,
      runs: 0,
      spend: 0,
    });
    addTo(providerEntry, cost);

    const endpointEntry = upsertBucket(endpoints, `${run.provider} ${run.endpoint}`, {
      provider: run.provider,
      providerName: run.providerName,
      endpoint: run.endpoint,
      runs: 0,
      spend: 0,
    });
    addTo(endpointEntry, cost);

    if (isFailedRun(run)) {
      failedRuns += 1;
      failedSpend += cost;
    }
  }

  const topRuns = [...items]
    .sort((a, b) => (b.cost?.value ?? 0) - (a.cost?.value ?? 0))
    .slice(0, TOP_RUNS);

  return {
    runs: items.length,
    spend,
    currency: currency ?? 'USD',
    providers: bySpend(providers),
    topEndpoints: bySpend(endpoints).slice(0, TOP_ENDPOINTS),
    topRuns,
    failedRuns,
    failedSpend,
    firstRunAt: items[items.length - 1]?.createdAt,
    lastRunAt: items[0]?.createdAt,
  };
}

/** A run that failed outright: errored, timed out, or the provider itself
 *  returned a non-2xx status. Excludes BLOCKED runs — those are a budget
 *  guardrail firing as intended, not a failure. */
function isFailedRun(run: RunListItem): boolean {
  if (run.status === 'FAILED' || run.status === 'TIME_OUT') return true;
  const httpStatus = run.providerResponse?.httpStatus;
  return httpStatus !== undefined && (httpStatus < 200 || httpStatus >= 300);
}

function upsertBucket(
  map: Map<string, SpendBucket>,
  key: string,
  seed: SpendBucket,
): SpendBucket {
  const existing = map.get(key);
  if (existing) return existing;
  map.set(key, seed);
  return seed;
}

function addTo(entry: SpendBucket, cost: number): void {
  entry.runs += 1;
  entry.spend += cost;
}

function bySpend(map: Map<string, SpendBucket>): SpendBucket[] {
  return [...map.values()].sort((a, b) => b.spend - a.spend);
}
