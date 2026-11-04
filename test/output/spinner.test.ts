import { describe, it, expect, spyOn, afterEach } from 'bun:test';
import {
  startSpinner,
  succeedSpinner,
  failSpinner,
  updateSpinner,
  stopSpinner,
} from '../../src/output/spinner.js';

const original = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');

function setTTY(value: boolean): void {
  Object.defineProperty(process.stderr, 'isTTY', { value, configurable: true });
}

function captureStderr(fn: () => void): string {
  const write = spyOn(process.stderr, 'write').mockImplementation(() => true);
  const err = spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    process.stderr.write(a.join(' ') + '\n');
  });
  try {
    fn();
    return write.mock.calls.map((c) => String(c[0])).join('');
  } finally {
    write.mockRestore();
    err.mockRestore();
  }
}

afterEach(() => {
  stopSpinner();
  if (original) Object.defineProperty(process.stderr, 'isTTY', original);
  else delete (process.stderr as { isTTY?: boolean }).isTTY;
});

describe('spinner with non-terminal stderr', () => {
  it('writes no progress or success lines', () => {
    setTTY(false);
    const out = captureStderr(() => {
      startSpinner('Searching...');
      updateSpinner('Still searching...');
      succeedSpinner('Found 3 result(s)');
    });
    expect(out).toBe('');
  });

  it('still reports failures', () => {
    setTTY(false);
    const out = captureStderr(() => {
      startSpinner('Running...');
      failSpinner('Run failed: run-a');
    });
    expect(out).toContain('Run failed: run-a');
  });
});
