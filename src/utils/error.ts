import chalk from 'chalk';
import { API_BASE_URL } from '../config/constants.js';

/**
 * A run the server returned with a non-2xx status. On the sync `POST /v1/run`
 * the server mirrors the PROVIDER's status (COMPLETED run) or answers 408 for
 * a run that exceeded its deadline (TIMED_OUT run). Either way Monid itself
 * did not reject the call.
 */
export interface ProviderRun {
  runId: string;
  status: 'COMPLETED' | 'TIMED_OUT';
  /** The provider's own status (`providerResponse.httpStatus`), else the HTTP status. */
  httpStatus: number;
}

export interface MonidErrorDetails {
  /** Whole seconds from the `Retry-After` header. */
  retryAfterSec?: number;
  /**
   * What the command asked for (`tinyfish /search`, `discover`, ...). The
   * API's 429 never names the rule that fired; the CLI knows the call.
   */
  limitedOn?: string;
  /**
   * Set when the error status came with a run body (the provider's status,
   * or a timed-out run), not from Monid rejecting the call.
   */
  providerRun?: ProviderRun;
}

export class MonidError extends Error {
  code: string;
  statusCode?: number;
  retryAfterSec?: number;
  limitedOn?: string;
  providerRun?: ProviderRun;

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
    const { runId, status, httpStatus } = err.providerRun;
    if (status === 'TIMED_OUT') {
      return `Run ${runId} timed out. Details: monid runs get -r ${runId}`;
    }
    const who = err.limitedOn ?? 'The provider';
    return (
      `${who}: the provider returned HTTP ${httpStatus} (run ${runId}). ` +
      `This is the provider's response, not a problem with your Monid API key. ` +
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
  let run: ProviderRun | undefined;

  if (err instanceof MonidError) {
    run = err.providerRun;
    // A status mirrored from the provider (or a timed-out run) is not a Monid
    // auth/forbidden/rate-limit error; don't let agents read it as one.
    code = run
      ? (run.status === 'TIMED_OUT' ? 'RUN_TIMED_OUT' : 'PROVIDER_ERROR')
      : err.code;
    message = friendlyMessage(err);
  } else if (err instanceof Error) {
    message = err.message;
  } else {
    message = String(err);
  }

  if (json) {
    const extra = run
      ? {
          runId: run.runId,
          ...(run.status === 'COMPLETED' ? { providerHttpStatus: run.httpStatus } : {}),
        }
      : {};
    console.log(JSON.stringify({ error: { code, message, ...extra } }, null, 2));
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
