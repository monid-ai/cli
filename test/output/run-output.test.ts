import { describe, it, expect, afterAll } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeRunOutput, findDownloadEnvelope } from '../../src/output/format.js';
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

describe('download envelope', () => {
  const envelope = {
    download_link: 'https://files.example/x',
    content_type: 'application/json',
    link_expires_at: '2026-11-05T00:00:00.000Z',
    file_expires_at: '2026-11-06T00:00:00.000Z',
  };

  it('finds the envelope at the top level or under data, not in inline bodies', () => {
    expect(findDownloadEnvelope(envelope)?.download_link).toBe(envelope.download_link);
    expect(findDownloadEnvelope({ data: envelope })?.download_link).toBe(envelope.download_link);
    expect(findDownloadEnvelope({ items: [1] })).toBeUndefined();
    expect(findDownloadEnvelope(undefined)).toBeUndefined();
  });

  it('tells the user the -o file holds a link, not the body', () => {
    const path = join(dir, 'env.json');
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => void lines.push(a.join(' '));
    try {
      writeRunOutput(makeRun({ providerResponse: { httpStatus: 200, data: envelope } }), path);
    } finally {
      console.log = orig;
    }
    expect(lines.join('\n')).toContain('download link');
    expect(lines.join('\n')).toContain(envelope.link_expires_at);
  });

  it('stays quiet in json mode and for inline bodies', () => {
    const path = join(dir, 'quiet.json');
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => void lines.push(a.join(' '));
    try {
      writeRunOutput(makeRun({ output: envelope }), path, true);
      writeRunOutput(makeRun({ output: { items: [1] } }), path);
    } finally {
      console.log = orig;
    }
    expect(lines.join('\n')).not.toContain('download link');
  });
});
