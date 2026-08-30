import chalk from 'chalk';
import type {
  EndpointHealthStatus,
  ResourceState,
  RunStatus,
} from '../api/types.js';

export function success(message: string): void {
  console.log(`${chalk.green('✓')} ${message}`);
}

export function error(message: string): void {
  console.error(`${chalk.red('✗')} ${message}`);
}

export function info(message: string): void {
  console.log(`${chalk.blue('→')} ${message}`);
}

export function muted(message: string): string {
  return chalk.gray(message);
}

export function statusBadge(status: RunStatus): string {
  switch (status) {
    case 'READY':
      return chalk.cyan(status);
    case 'RUNNING':
      return chalk.yellow(status);
    case 'COMPLETED':
      return chalk.green(status);
    case 'FAILED':
      return chalk.red(status);
    case 'BLOCKED':
      return chalk.yellow(status);
    case 'STOPPED':
      return chalk.gray(status);
    case 'TIME_OUT':
      return chalk.red(status);
    default:
      return status;
  }
}

export function resourceStateBadge(state: ResourceState): string {
  switch (state) {
    case 'READY':
      return chalk.cyan(state);
    case 'PROVISIONING':
      return chalk.yellow(state);
    case 'ACTIVE':
      return chalk.green(state);
    case 'EXPIRING':
      return chalk.yellow(state);
    case 'SUSPENDED':
      return chalk.red(state);
    case 'RELEASED':
      return chalk.gray(state);
    case 'PROVISION_FAILED':
      return chalk.red(state);
    default:
      return state;
  }
}

/**
 * Render an endpoint health verdict for display.
 *
 * EVERY verdict the server sends is printed, including `unknown`. Hiding
 * `unknown` was tried and reverted: on a backend where it is the majority
 * verdict the column reads as broken rather than quiet, and a reader cannot
 * tell "no verdict" apart from "the CLI dropped it". Only a genuinely absent
 * status (no `metrics` block at all) renders empty.
 *
 * Coloring, applied only to the verdicts whose meaning is settled:
 *  - `healthy` / `stable` — GREEN. Both are good news, differing only in how
 *    recently it was confirmed (working in the last few minutes vs. a strong
 *    longer track record). Coloring `stable` as a caution would flag the
 *    common good case.
 *  - `degraded` YELLOW — a caution, not a rejection: it still works in most
 *    cases. `outage` RED — known not to be working.
 *  - `unknown` and anything unrecognized — UNCOLORED. Neither good nor bad,
 *    and color would assert a judgment the value does not carry.
 *
 * Unrecognized values print verbatim rather than being dropped, so a verdict
 * added server-side surfaces without a CLI release. This is load-bearing, not
 * theoretical: `stable` itself reached the CLI through this path.
 *
 * Color is decoration only — the word carries the meaning, so `NO_COLOR=1`
 * output (which chalk honors) stays fully readable for agents.
 */
export function healthBadge(status: EndpointHealthStatus | undefined): string {
  switch (status) {
    case undefined:
      return '';
    case 'healthy':
    case 'stable':
      return chalk.green(status);
    case 'degraded':
      return chalk.yellow(status);
    case 'outage':
      return chalk.red(status);
    default:
      return status;
  }
}

export function price(amount: number, currency: string): string {
  return `$${amount.toFixed(4)} ${currency}`;
}
