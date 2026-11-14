import { describe, it, expect } from 'bun:test';
import { runSetup } from '../../src/commands/setup.js';
import type { SetupTelemetryRequest } from '../../src/api/types.js';

function harness(send: (i: SetupTelemetryRequest) => Promise<void>) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    deps: { send, out: (l: string) => out.push(l), err: (l: string) => err.push(l), env: {} },
  };
}

describe('runSetup', () => {
  it('prints a confirmation line on success', async () => {
    const sent: SetupTelemetryRequest[] = [];
    const h = harness(async (i) => {
      sent.push(i);
    });
    await runSetup({ client: 'dsh' }, h.deps);
    expect(sent).toEqual([{ source: 'cli', client: 'dsh' }]);
    expect(h.out).toHaveLength(1);
    expect(h.out[0]).toContain('setup complete');
    expect(h.out[0]).toContain('dsh');
    expect(h.err).toEqual([]);
  });

  it('confirms even when no client is given', async () => {
    const h = harness(async () => {});
    await runSetup({}, h.deps);
    expect(h.out).toHaveLength(1);
    expect(h.out[0]).toContain('setup complete');
  });

  it('does not throw and reports on stderr when the signal fails', async () => {
    const h = harness(async () => {
      throw new Error('HTTP 500');
    });
    await runSetup({}, h.deps);
    expect(h.out).toEqual([]);
    expect(h.err).toHaveLength(1);
    expect(h.err[0]).toContain('could not be sent');
  });
});
