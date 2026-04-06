import chalk from 'chalk';
import type { RunStatus } from '../api/types.js';

export function success(message: string): void {
  console.log(`${chalk.green('✓')} ${message}`);
}

export function error(message: string): void {
  console.error(`${chalk.red('✗')} ${message}`);
}

export function info(message: string): void {
  console.log(`${chalk.blue('→')} ${message}`);
}

export function dim(message: string): string {
  return chalk.dim(message);
}

export function statusBadge(status: RunStatus): string {
  switch (status) {
    case 'RUNNING':
      return chalk.yellow(status);
    case 'COMPLETED':
      return chalk.green(status);
    case 'FAILED':
      return chalk.red(status);
    default:
      return status;
  }
}

export function price(amount: number, currency: string): string {
  return `$${amount.toFixed(4)} ${currency}`;
}
