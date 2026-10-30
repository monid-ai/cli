import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENTRY = new URL('../../src/index.ts', import.meta.url).pathname;

/** Run the CLI against an empty config dir: once the run ID is accepted it
 *  stops at "No active API key", before any request is sent. */
function cli(...args: string[]): string {
  const res = spawnSync(process.execPath, [ENTRY, ...args], {
    env: { ...process.env, XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'monid-test-')) },
    encoding: 'utf-8',
  });
  return res.stderr;
}

describe.each(['get', 'stop'])('monid runs %s', (sub) => {
  it('accepts the run ID as a positional', () => {
    expect(cli('runs', sub, '01RUN')).toContain('No active API key');
  });

  it('still accepts -r', () => {
    expect(cli('runs', sub, '-r', '01RUN')).toContain('No active API key');
  });

  it('requires a run ID', () => {
    expect(cli('runs', sub)).toContain('A run ID is required');
  });

  it('rejects a positional and -r together', () => {
    expect(cli('runs', sub, '01RUN', '-r', '01OTHER')).toContain('not both');
  });
});
