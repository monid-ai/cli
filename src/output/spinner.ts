import ora, { type Ora } from 'ora';

let activeSpinner: Ora | null = null;

export function startSpinner(text: string): Ora {
  activeSpinner = ora({ text }).start();
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
    activeSpinner.fail(text);
    activeSpinner = null;
  }
}

export function updateSpinner(text: string): void {
  if (activeSpinner) {
    activeSpinner.text = text;
  }
}
