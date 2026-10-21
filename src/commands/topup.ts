import { spawn } from 'node:child_process';
import { Command } from '@cliffy/command';
import chalk from 'chalk';
import { MonidAPI } from '../api/client.js';
import { ConfigManager } from '../config/manager.js';
import { WEB_BASE_URL } from '../config/constants.js';
import { handleError, MonidError } from '../utils/error.js';
import { printUpdateNotice, applyUpdateNote } from '../utils/update-check.js';
import {
  startSpinner,
  succeedSpinner,
  stopSpinner,
} from '../output/spinner.js';

/** Validate the dollar amount (the API enforces the min/max). */
export function parseTopupAmount(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new MonidError(
      'INVALID_INPUT',
      'Amount must be a positive number of US dollars, e.g. -a 5.',
    );
  }
  return Math.round(amount * 100) / 100;
}

/**
 * The message for a key that may not create checkout sessions (403): the
 * human tops up in the dashboard instead.
 */
export function noTopupScopeMessage(): string {
  return `This API key can't create a checkout link. Top up at ${WEB_BASE_URL}/wallet.`;
}

/** Best-effort: open a URL in the default browser (never fails the command). */
function openInBrowser(url: string): void {
  const cmd = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // No browser available (CI, SSH) — the printed link is enough.
  }
}

export const topupCommand = new Command()
  .name('topup')
  .description(
    'Create a one-time checkout link to fund the workspace wallet, then open it to pay.',
  )
  .option('-a, --amount <dollars:number>', 'Amount in US dollars.', {
    required: true,
  })
  .option('--no-open', 'Print the checkout link without opening the browser.')
  .option('-j, --json', 'Output as JSON.')
  .action(async ({ amount, open, json }) => {
    try {
      const dollars = parseTopupAmount(amount);

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
        startSpinner('Creating checkout link...');
      }

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
      if (err instanceof MonidError && err.statusCode === 403) {
        handleError(new MonidError('FORBIDDEN', noTopupScopeMessage()), json);
      }
      handleError(err, json);
    }
  });
