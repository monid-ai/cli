import chalk from 'chalk';
import { API_BASE_URL } from '../config/constants.js';

export interface MonidErrorDetails {
  /** Whole seconds from the `Retry-After` header. */
  retryAfterSec?: number;
  /**
   * What the command asked for (`tinyfish /search`, `discover`, ...). The
   * API's 429 never names the rule that fired; the CLI knows the call.
   */
  limitedOn?: string;
  /**
   * Set when the error status came from the PROVIDER (a sync run returned a
   * COMPLETED run body with a non-2xx status), not from Monid itself.
   */
  providerRun?: { runId: string; httpStatus: number };
}

export class MonidError extends Error {
  code: string;
  statusCode?: number;
  retryAfterSec?: number;
  limitedOn?: string;
  providerRun?: { runId: string; httpStatus: number };

  constructor(
    code: string,
    message: string,
    statusCode?: number,
    details: MonidErrorDetails = {},
  ) {
    super(message);
    this.name = 'MonidError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryAfterSec = details.retryAfterSec;
    this.limitedOn = details.limitedOn;
    this.providerRun = details.providerRun;
  }
}

/** `Rate limited on tinyfish /search. Retry after 37s.` */
export function rateLimitedMessage(err: MonidError): string {
  const on = err.limitedOn ? ` on ${err.limitedOn}` : '';
  const wait = err.retryAfterSec
    ? ` Retry after ${err.retryAfterSec}s.`
    : ' Please try again later.';
  return `Rate limited${on}.${wait}`;
}

/**
 * Build a user-friendly message for common HTTP error codes.
 * Always returns a helpful message regardless of --json mode.
 */
function friendlyMessage(err: MonidError): string {
  const serverMsg = err.message;

  // The provider answered; Monid did not reject the call. Never present it
  // as an expired Monid key or a Monid workspace rate limit.
  if (err.providerRun) {
    const { runId, httpStatus } = err.providerRun;
    const who = err.limitedOn ?? 'The provider';
    return (
      `${who}: the provider returned HTTP ${httpStatus} (run ${runId}). ` +
      `This is the provider's response, not a Monid error. ` +
      `Details: monid runs get -r ${runId}`
    );
  }

  switch (err.statusCode) {
    case 400:
      return `Invalid input: ${serverMsg}`;
    case 401:
      return `API key is expired or invalid. Get a new one at ${API_BASE_URL}/access/api-keys`;
    case 402:
      return `Insufficient balance. Top up at ${API_BASE_URL}/wallet`;
    case 403:
      return `Access denied: ${serverMsg}`;
    case 404:
      return `Not found: ${serverMsg}`;
    case 429:
      return rateLimitedMessage(err);
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
  let fromProvider = false;

  if (err instanceof MonidError) {
    fromProvider = err.providerRun !== undefined;
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

  if (code === 'AUTH_FAILED' && !fromProvider) {
    console.error(
      chalk.gray("  Run 'monid keys add' to configure an API key."),
    );
  }

  process.exit(1);
}
