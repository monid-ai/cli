import { describe, it, expect, afterAll } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeRunOutput } from '../../src/output/format.js';
import type { RunDetailResponse } from '../../src/api/types.js';

const dir = mkdtempSync(join(tmpdir(), 'monid-run-output-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Build a completed run fixture, with overrides for output and pending states. */
function makeRun(overrides: Partial<RunDetailResponse>): RunDetailResponse {
  return {
    runId: 'run-a',
    caller: 'caller',
    provider: 'apify',
    endpoint: '/tweets',
    status: 'COMPLETED',
    price: {} as RunDetailResponse['price'],
    createdAt: '2026-10-26T00:00:00.000Z',
    ...overrides,
  };
}

describe('writeRunOutput', () => {
  it('writes the resolved output as pretty JSON', () => {
    const path = join(dir, 'out.json');
    writeRunOutput(makeRun({ output: { items: [1, 2] } }), path, true);
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({ items: [1, 2] });
  });

  it('writes nothing while the run has no output yet', () => {
    const path = join(dir, 'pending.json');
    writeRunOutput(makeRun({ status: 'RUNNING' }), path, true);
    expect(existsSync(path)).toBe(false);
  });
});
