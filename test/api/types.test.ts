import { describe, it, expect } from 'bun:test';
import { isTerminalRunStatus, type RunStatus } from '../../src/api/types.js';

describe('isTerminalRunStatus', () => {
  // The server's terminal set. `--wait` must stop on every one of these;
  // missing one means polling until the client-side timeout.
  it.each(['COMPLETED', 'FAILED', 'BLOCKED', 'STOPPED', 'TIMED_OUT'] as RunStatus[])(
    'stops polling on %s',
    (status) => {
      expect(isTerminalRunStatus(status)).toBe(true);
    },
  );

  it.each(['READY', 'RUNNING', 'STOPPING'] as RunStatus[])(
    'keeps polling on %s',
    (status) => {
      expect(isTerminalRunStatus(status)).toBe(false);
    },
  );

  it('does not recognise the misspelled TIME_OUT (the server never sends it)', () => {
    expect(isTerminalRunStatus('TIME_OUT' as RunStatus)).toBe(false);
  });
});
