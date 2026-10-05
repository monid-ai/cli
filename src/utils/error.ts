import chalk from 'chalk';
import { API_BASE_URL } from '../config/constants.js';

/** Exit code for a rate-limited command: EX_TEMPFAIL — "try again later". */
export const EXIT_RATE_LIMITED = 75;

/** The binding limit from the public `RateLimit-*` headers (numbers only). */
export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  resetSec?: number;
}

export interface MonidErrorDetails {
  /** The server's documented machine code (body `errorCode`), if any. */
  errorCode?: string;
  /** Whole seconds from the `Retry-After` header. */
  retryAfterSec?: number;
  rateLimit?: RateLimitInfo;
  /**
   * What the command asked for (`tinyfish /search`, `discover`, ...). The
   * API's 429 never names the rule that fired; the CLI knows the call.
   */
  limitedOn?: string;
}

export class MonidError extends Error {
  code: string;
  statusCode?: number;
  errorCode?: string;
  retryAfterSec?: number;
  rateLimit?: RateLimitInfo;
  limitedOn?: string;

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
    this.errorCode = details.errorCode;
    this.retryAfterSec = details.retryAfterSec;
    this.rateLimit = details.rateLimit;
    this.limitedOn = details.limitedOn;
  }
}

export function isRateLimited(err: unknown): err is MonidError {
  return err instanceof MonidError && err.code === 'RATE_LIMITED';
}

/** `Monid: Rate limited on tinyfish /search. Retry after 37s.` (no color). */
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

  // A rate limit is a "come back later", not a failure of the command's
  // input: shown in yellow without `error:`, with its own exit code so
  // scripts and agents can wait `retryAfterSec` and retry.
  if (isRateLimited(err)) {
    const message = rateLimitedMessage(err);
    if (json) {
      console.log(JSON.stringify({
        rateLimited: {
          message,
          ...(err.retryAfterSec !== undefined ? { retryAfterSec: err.retryAfterSec } : {}),
          ...(err.limitedOn ? { limitedOn: err.limitedOn } : {}),
          ...(err.rateLimit ? { rateLimit: err.rateLimit } : {}),
        },
      }, null, 2));
    } else {
      console.error(`${chalk.yellow('Monid:')} ${message}`);
    }
    process.exit(EXIT_RATE_LIMITED);
  }

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
