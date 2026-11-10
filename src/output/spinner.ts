import ora, { type Ora } from 'ora';

let activeSpinner: Ora | null = null;

/**
 * Progress goes to stderr. When stderr is not a terminal (redirected, captured
 * by an agent, or merged with `2>&1`), Windows PowerShell wraps every stderr
 * line of a native command in a red `NativeCommandError` record, so progress
 * and success lines are only worth emitting for an interactive stderr.
 * Failures are still reported.
 */
function isInteractive(): boolean {
  return Boolean(process.stderr.isTTY);
}

export function startSpinner(text: string): Ora {
  activeSpinner = ora({ text, isSilent: !isInteractive() }).start();
  return activeSpinner;
}

export function stopSpinner(): void {
  if (activeSpinner) {
    activeSpinner.stop();
    activeSpinner = null;
  }
}

export function succeedSpinner(text: string): void {
  if (activeSpinner) {
    activeSpinner.succeed(text);
    activeSpinner = null;
  }
}

export function failSpinner(text: string): void {
  if (activeSpinner) {
    if (isInteractive()) {
      activeSpinner.fail(text);
    } else {
      activeSpinner.stop();
      console.error(`✖ ${text}`);
    }
    activeSpinner = null;
  }
}

export function updateSpinner(text: string): void {
  if (activeSpinner) {
    activeSpinner.text = text;
  }
}
