import { spawn } from 'node:child_process';
import { Command } from '@cliffy/command';
import chalk from 'chalk';
import { MonidAPI } from '../api/client.js';
import type { TopupConfigResponse } from '../api/types.js';
import { ConfigManager } from '../config/manager.js';
import { WEB_BASE_URL } from '../config/constants.js';
import { handleError, MonidError } from '../utils/error.js';
import { printUpdateNotice, applyUpdateNote } from '../utils/update-check.js';
import {
  startSpinner,
  succeedSpinner,
  stopSpinner,
} from '../output/spinner.js';

/**
 * Validate the dollar amount and round it to cents. The workspace limits
 * are checked separately (`checkTopupLimits`) against the API's config.
 */
export function parseTopupAmount(amount: number): number {
  const rounded = Math.round(amount * 100) / 100;
  if (!Number.isFinite(amount) || rounded <= 0) {
    throw new MonidError(
      'INVALID_INPUT',
      'Amount must be a positive number of US dollars, e.g. -a 5.',
    );
  }
  return rounded;
}

/** `5` → `5`, `5.5` → `5.50`: a dollar amount as an `-a` argument. */
function amountArg(dollars: number): string {
  return Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
}

/**
 * Reject an amount outside the workspace's top-up limits, naming the limit
 * and a command that works. The server enforces the same limits; this only
 * gives a clearer error before a session is created.
 */
export function checkTopupLimits(
  dollars: number,
  config: Pick<TopupConfigResponse, 'minAmount' | 'maxAmount'>,
): void {
  if (dollars < config.minAmount) {
    throw new MonidError(
      'INVALID_INPUT',
      `Minimum top-up is $${config.minAmount.toFixed(2)} (you asked for $${dollars.toFixed(2)}). Try: monid topup -a ${amountArg(config.minAmount)}`,
    );
  }
  if (config.maxAmount !== undefined && dollars > config.maxAmount) {
    throw new MonidError(
      'INVALID_INPUT',
      `Maximum top-up is $${config.maxAmount.toFixed(2)} (you asked for $${dollars.toFixed(2)}). Try: monid topup -a ${amountArg(config.maxAmount)}`,
    );
  }
}

/**
 * Best-effort read of the top-up limits before creating a session. Any
 * failure (a key without `wallet:read`, an inactive wallet, the network)
 * returns undefined: the session call still runs and the server's own
 * limit check applies.
 */
export async function fetchTopupLimits(
  api: Pick<MonidAPI, 'getTopupConfig'>,
): Promise<TopupConfigResponse | undefined> {
  try {
    return await api.getTopupConfig();
  } catch {
    return undefined;
  }
}

/** Human-readable top-up limits, for `monid topup` with no amount. */
export function formatTopupLimits(config: TopupConfigResponse): string[] {
  const max = config.maxAmount !== undefined
    ? `, maximum $${config.maxAmount.toFixed(2)}`
    : '';
  const lines = [
    `  Top-up limits: minimum $${config.minAmount.toFixed(2)}${max} (${config.currency})`,
  ];
  if (config.processingFee?.description) {
    lines.push(`  ${config.processingFee.description}`);
  }
  lines.push(`  Run: monid topup -a <dollars>`);
  return lines;
}

/**
 * The message for a key that may not create checkout sessions (403): the
 * human tops up in the dashboard instead.
 */
export function noTopupScopeMessage(): string {
  return `This API key can't create a checkout link. Top up at ${WEB_BASE_URL}/wallet.`;
}

/**
 * The opener command for a checkout URL, or undefined when the URL is not
 * http(s). Never goes through a shell: on Windows `cmd /c start` would read
 * `&`, `^` and `%` in the URL as shell syntax.
 */
export function browserCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): [string, string[]] | undefined {
  let target: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return undefined;
    }
    target = parsed.href;
  } catch {
    return undefined;
  }
  if (platform === 'darwin') return ['open', [target]];
  if (platform === 'win32') {
    return ['rundll32', ['url.dll,FileProtocolHandler', target]];
  }
  return ['xdg-open', [target]];
}

/** Best-effort: open a URL in the default browser (never fails the command). */
function openInBrowser(url: string): void {
  const command = browserCommand(url);
  if (!command) return;
  try {
    const child = spawn(command[0], command[1], {
      stdio: 'ignore',
      detached: true,
    });
    child.on('error', () => {});
    child.unref();
  } catch {
    // No browser available (CI, SSH) — the printed link is enough.
  }
}

export const topupCommand = new Command()
  .name('topup')
  .description(
    'Create a one-time checkout link to fund the workspace wallet, then open it to pay. Without -a, show the top-up limits.',
  )
  .option(
    '-a, --amount <dollars:number>',
    'Amount in US dollars. At least the workspace minimum (currently $5); run without -a to see the live limits.',
  )
  .option('--no-open', 'Print the checkout link without opening the browser.')
  .option('-j, --json', 'Output as JSON.')
  .action(async ({ amount, open, json }) => {
    // Only a 403 from creating the session means "no topups:create".
    let creatingSession = false;
    try {
      const dollars = amount === undefined ? undefined : parseTopupAmount(amount);

      const config = new ConfigManager();
      const active = config.getActiveKey();
      if (!active) {
        throw new MonidError(
          'AUTH_FAILED',
          'No active API key. Run "monid keys add" to configure one.',
        );
      }

      const api = new MonidAPI({ apiKey: active.credential.key });

      if (dollars === undefined) {
        if (!json) startSpinner('Fetching top-up limits...');
        const limits = await api.getTopupConfig();
        const updateInfo = await config.getUpdateInfo();
        if (json) {
          const output = updateInfo ? applyUpdateNote(limits, updateInfo) : limits;
          console.log(JSON.stringify(output, null, 2));
          return;
        }
        stopSpinner();
        console.log();
        for (const line of formatTopupLimits(limits)) console.log(line);
        console.log();
        if (updateInfo) printUpdateNotice(updateInfo);
        return;
      }

      if (!json) startSpinner('Creating checkout link...');

      const limits = await fetchTopupLimits(api);
      if (limits) checkTopupLimits(dollars, limits);

      creatingSession = true;
      const session = await api.createTopupSession(dollars);
      const updateInfo = await config.getUpdateInfo();

      if (json) {
        const output = updateInfo ? applyUpdateNote(session, updateInfo) : session;
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      succeedSpinner(`Checkout link for $${dollars.toFixed(2)} created`);
      console.log();
      console.log(`  ${chalk.bold('Open to pay:')} ${chalk.cyan(session.url)}`);
      console.log(
        chalk.gray('  The wallet is funded as soon as the payment completes.'),
      );
      console.log();
      if (open && process.stdout.isTTY) openInBrowser(session.url);
      if (updateInfo) printUpdateNotice(updateInfo);
    } catch (err) {
      stopSpinner();
      const noScope =
        creatingSession && err instanceof MonidError && err.statusCode === 403;
      handleError(
        noScope ? new MonidError('FORBIDDEN', noTopupScopeMessage()) : err,
        json,
      );
    }
  });
