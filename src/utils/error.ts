import chalk from 'chalk';

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
 * Print a user-friendly error message and exit.
 * If --json mode, output structured JSON error.
 */
export function handleError(err: unknown, json: boolean = false): never {
  if (json) {
    if (err instanceof MonidError) {
      console.log(
        JSON.stringify(
          { error: { code: err.code, message: err.message } },
          null,
          2,
        ),
      );
    } else if (err instanceof Error) {
      console.log(
        JSON.stringify(
          { error: { code: 'UNKNOWN', message: err.message } },
          null,
          2,
        ),
      );
    } else {
      console.log(
        JSON.stringify(
          { error: { code: 'UNKNOWN', message: String(err) } },
          null,
          2,
        ),
      );
    }
    process.exit(1);
  }

  if (err instanceof MonidError) {
    console.error(`${chalk.red('monid: error:')} ${err.message}`);
    if (err.code === 'AUTH_FAILED') {
      console.error(
        chalk.dim("  Run 'monid keys add' to configure an API key."),
      );
    }
  } else if (err instanceof Error) {
    console.error(`${chalk.red('monid: error:')} ${err.message}`);
  } else {
    console.error(`${chalk.red('monid: error:')} ${String(err)}`);
  }
  process.exit(1);
}
