import chalk from 'chalk';
import { WEB_BASE_URL } from '../config/constants.js';
import type { TopupHints } from '../api/types.js';

export class MonidError extends Error {
  code: string;
  statusCode?: number;
  /** Funding hints from a 402 body (`topup`), when the API sent them. */
  topup?: TopupHints;

  constructor(
    code: string,
    message: string,
    statusCode?: number,
    topup?: TopupHints,
  ) {
    super(message);
    this.name = 'MonidError';
    this.code = code;
    this.statusCode = statusCode;
    this.topup = topup;
  }
}

/**
 * The 402 message: the server's own text (it names the shortfall and the
 * right dashboard for this environment), plus the CLI command that creates a
 * checkout link when the key may (`topup.stripe` is only sent then).
 */
export function insufficientFundsMessage(err: MonidError): string {
  const dashboard = err.topup?.dashboard ?? `${WEB_BASE_URL}/wallet`;
  const base = err.message && err.message !== 'HTTP 402'
    ? err.message
    : `Not enough wallet balance. Top up at ${dashboard}.`;
  return err.topup?.stripe
    ? `${base}\n  Or run: monid topup -a <AMOUNT>  (prints a checkout link to pay)`
    : base;
}

/**
 * Build a user-friendly message for common HTTP error codes.
 * Always returns a helpful message regardless of --json mode.
 */
export function friendlyMessage(err: MonidError): string {
  const serverMsg = err.message;

  switch (err.statusCode) {
    case 400:
      return `Invalid input: ${serverMsg}`;
    case 401:
      return `API key is expired or invalid. Get a new one at ${WEB_BASE_URL}/access/api-keys`;
    case 402:
      return insufficientFundsMessage(err);
    case 403:
      return `Access denied: ${serverMsg}`;
    case 404:
      return `Not found: ${serverMsg}`;
    case 429:
      return `Rate limited. Please try again later.`;
    default:
      if (err.statusCode && err.statusCode >= 500) {
        return serverMsg
          ? `Something went wrong. Please try again later. (${serverMsg})`
          : `Something went wrong. Please try again later.`;
      }
      return serverMsg;
  }
}

/**
 * Print a user-friendly error message and exit.
 * If --json mode, output structured JSON error with friendly message.
 */
export function handleError(err: unknown, json: boolean = false): never {
  let code = 'UNKNOWN';
  let message: string;

  if (err instanceof MonidError) {
    code = err.code;
    message = friendlyMessage(err);
  } else if (err instanceof Error) {
    message = err.message;
  } else {
    message = String(err);
  }

  if (json) {
    console.log(JSON.stringify({ error: { code, message } }, null, 2));
    process.exit(1);
  }

  console.error(`${chalk.red('monid: error:')} ${message}`);

  if (code === 'AUTH_FAILED') {
    console.error(
      chalk.gray("  Run 'monid keys add' to configure an API key."),
    );
  }

  process.exit(1);
}
