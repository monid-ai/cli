import chalk from 'chalk';
import { WEB_BASE_URL } from '../config/constants.js';
import { PollTimeoutError } from './poll.js';
import { isTerminalRunStatus, type RunStatus, type TopupHints } from '../api/types.js';

/** What a failed call knows beyond its HTTP status. */
export interface RunErrorContext {
  /** The server-side run the failure belongs to, when one exists. */
  runId?: string;
  /** Last known run status, when the failure happened while waiting. */
  status?: string;
  /** Whole seconds from a 429's `Retry-After` header. */
  retryAfterSec?: number;
  /**
   * What the command asked for (`tinyfish /search`, `discover`, ...). The
   * API's 429 never names the rule that fired; the CLI knows the call.
   */
  limitedOn?: string;
  /** Funding hints from a 402 body (`topup`), when the API sent them. */
  topup?: TopupHints;
  /** The error body's `hints`: what to do next, rendered for the CLI. */
  hints?: Record<string, unknown>;
}

export class MonidError extends Error {
  code: string;
  statusCode?: number;
  runId?: string;
  status?: string;
  retryAfterSec?: number;
  limitedOn?: string;
  topup?: TopupHints;
  hints?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    statusCode?: number,
    context?: RunErrorContext,
  ) {
    super(message);
    this.name = 'MonidError';
    this.code = code;
    this.statusCode = statusCode;
    this.runId = context?.runId;
    this.status = context?.status;
    this.retryAfterSec = context?.retryAfterSec;
    this.limitedOn = context?.limitedOn;
    this.topup = context?.topup;
    this.hints = context?.hints;
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
  // The API's own "top up the wallet" hint already names the command.
  return err.topup?.stripe && !err.hints?.['top up the wallet']
    ? `${base}\n  Or run: monid topup -a <AMOUNT>  (prints a checkout link to pay)`
    : base;
}

/** `Rate limited on tinyfish /search. Retry after 37s.` */
export function rateLimitedMessage(err: MonidError): string {
  const on = err.limitedOn ? ` on ${err.limitedOn}` : '';
  const wait =
    err.retryAfterSec !== undefined ? ` Retry after ${err.retryAfterSec}s.` : ' Please try again later.';
  return `Rate limited${on}.${wait}`;
}

/**
 * Return `err` as a MonidError that carries the run it belongs to, so a
 * failure AFTER the server created the run (a poll error, a --wait timeout)
 * never loses the run id the user needs to resume with `monid runs get`.
 */
export function withRunContext(err: unknown, context: RunErrorContext): MonidError {
  if (err instanceof MonidError) {
    err.runId ??= context.runId;
    err.status ??= context.status;
    return err;
  }
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof PollTimeoutError ? 'POLL_TIMEOUT' : 'UNKNOWN';
  return new MonidError(code, message, undefined, context);
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
 * Print a user-friendly error message and mark the process as failed.
 * If --json mode, output structured JSON error with friendly message.
 *
 * This sets process.exitCode rather than calling process.exit(): exiting
 * while handles (spinner, stdin, fetch sockets) are still closing trips the
 * libuv `UV_HANDLE_CLOSING` assertion on Windows. Callers must return after
 * calling it; the process exits on its own once the event loop drains.
 */
export function handleError(err: unknown, json: boolean = false): void {
  let code = 'UNKNOWN';
  let message: string;
  let context: RunErrorContext = {};

  if (err instanceof MonidError) {
    code = err.code;
    message = friendlyMessage(err);
    context = err;
  } else if (err instanceof Error) {
    message = err.message;
  } else {
    message = String(err);
  }

  if (json) {
    const out: Record<string, unknown> = { code, message };
    if (context.runId) out.runId = context.runId;
    if (context.status) out.status = context.status;
    if (context.hints) out.hints = context.hints;
    console.log(JSON.stringify({ error: out }, null, 2));
    process.exitCode = 1;
    return;
  }

  console.error(`${chalk.red('monid: error:')} ${message}`);
  if (context.runId) {
    console.error(
      `  Run ID: ${context.runId}${context.status ? ` (status: ${context.status})` : ''}`,
    );
    // "keeps going" is only true while the run is not terminal: an error
    // after a COMPLETED run (e.g. -o to an unwritable path) must not claim
    // the run is still in progress.
    const inProgress = !context.status || !isTerminalRunStatus(context.status as RunStatus);
    console.error(
      chalk.gray(
        inProgress
          ? `  The run keeps going. Check it with: monid runs get -r ${context.runId}`
          : `  Inspect it with: monid runs get -r ${context.runId}`,
      ),
    );
  }

  // AUTH_FAILED: the CLI's own "no key configured"; UNAUTHENTICATED: the
  // API rejected the key.
  if (code === 'AUTH_FAILED' || code === 'UNAUTHENTICATED') {
    console.error(
      chalk.gray("  Run 'monid keys add' to configure an API key."),
    );
  }

  printErrorHints(context.hints);

  process.exitCode = 1;
}

/** The API's next-step hints for an error, under the message (stderr). */
function printErrorHints(hints: Record<string, unknown> | undefined): void {
  const entries = Object.entries(hints ?? {}).filter(
    ([, value]) => value !== undefined && value !== null,
  );
  if (entries.length === 0) return;
  console.error();
  console.error(chalk.bold('Hints'));
  for (const [key, value] of entries) {
    const rendered = typeof value === 'object' ? JSON.stringify(value) : String(value);
    console.error(`  ${chalk.gray(`${key}:`)} ${rendered}`);
  }
}
