import chalk from 'chalk';
import { API_BASE_URL } from '../config/constants.js';

export class MonidError extends Error {
  code: string;
  statusCode?: number;

  constructor(code: string, message: string, statusCode?: number) {
    super(message);
    this.name = 'MonidError';
    this.code = code;
    this.statusCode = statusCode;
  }
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
    process.exitCode = 1;
    return;
  }

  console.error(`${chalk.red('monid: error:')} ${message}`);

  if (code === 'AUTH_FAILED') {
    console.error(
      chalk.gray("  Run 'monid keys add' to configure an API key."),
    );
  }

  process.exitCode = 1;
}
