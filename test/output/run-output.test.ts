import { describe, it, expect, afterAll, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeRunOutput, writeRunOutputJson, findOverflowLink, resolveOutputSource } from '../../src/output/format.js';
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
  it('writes the resolved output as pretty JSON', async () => {
    const path = join(dir, 'out.json');
    await writeRunOutput(makeRun({ output: { items: [1, 2] } }), path, true);
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({ items: [1, 2] });
  });

  it('writes nothing while the run has no output yet', async () => {
    const path = join(dir, 'pending.json');
    await writeRunOutput(makeRun({ status: 'RUNNING' }), path, true);
    expect(existsSync(path)).toBe(false);
  });
});

// The overflow envelope exactly as the service injects it into `output`.
const envelope = {
  download_link: 'https://sfs.monid.ai/tok?e=1',
  content_type: 'application/json',
  link_expires_at: '2026-11-09T13:00:00.000Z',
  file_expires_at: '2026-11-16T12:00:00.000Z',
};

describe('findOverflowLink', () => {
  it('matches the overflow shape under data or file, on any SFS environment', () => {
    expect(findOverflowLink({ data: envelope })).toBe(envelope.download_link);
    expect(findOverflowLink({ file: envelope })).toBe(envelope.download_link);
    const { file_expires_at: _, ...noFileExpiry } = envelope;
    expect(findOverflowLink({ data: noFileExpiry })).toBe(envelope.download_link);
    const dev = { ...envelope, download_link: 'https://sfs.dev.monid.ai/tok' };
    expect(findOverflowLink({ data: dev })).toBe(dev.download_link);
  });

  it('ignores file results and look-alikes', () => {
    // A media artifact next to provider fields (OpenAI image) is the result itself.
    expect(findOverflowLink({ size: '1024x640', usage: {}, image: { ...envelope, content_type: 'image/png' } })).toBeUndefined();
    // A provider-hosted URL (Seedance).
    expect(findOverflowLink({ id: 'cgt', content: { video_url: 'https://cdn/out.mp4' } })).toBeUndefined();
    // A provider body that happens to use the key, or a link off our host.
    expect(findOverflowLink({ data: { download_link: 'https://x.example/f' } })).toBeUndefined();
    expect(findOverflowLink({ data: { ...envelope, download_link: 'https://evil.example/f' } })).toBeUndefined();
    expect(findOverflowLink({ data: { ...envelope, download_link: 'http://sfs.monid.ai/tok' } })).toBeUndefined();
    expect(findOverflowLink({ data: { ...envelope, download_link: 'https://sfs.monid.ai.evil.example/t' } })).toBeUndefined();
    // Not the strict shape.
    expect(findOverflowLink({ data: envelope, other: 1 })).toBeUndefined();
    expect(findOverflowLink({ data: { ...envelope, extra: 1 } })).toBeUndefined();
    expect(findOverflowLink({ data: { ...envelope, link_expires_at: 'soon' } })).toBeUndefined();
    expect(findOverflowLink({ data: { ...envelope, file_expires_at: 'later' } })).toBeUndefined();
    // Retention lapsed: nothing to download.
    expect(findOverflowLink({ data: { expired: true, file_expired_at: envelope.file_expires_at, message: 'm' } })).toBeUndefined();
    expect(findOverflowLink({ items: [1] })).toBeUndefined();
    expect(findOverflowLink(undefined)).toBeUndefined();
  });
});

describe('writeRunOutput downloads an overflowed body', () => {
  const realFetch = globalThis.fetch;
  const origLog = console.log;
  let calls: string[] = [];
  let lines: string[] = [];

  function stubFetch(respond: () => Response): void {
    calls = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return respond();
    }) as typeof fetch;
  }
  function captureLog(): void {
    lines = [];
    console.log = (...a: unknown[]) => void lines.push(a.join(' '));
  }
  afterEach(() => {
    globalThis.fetch = realFetch;
    console.log = origLog;
    process.exitCode = 0;
  });

  const body = JSON.stringify({ oracles: Array.from({ length: 1000 }, (_, i) => ({ i })) });

  it('writes the fetched body under data or file, leaving no partial file', async () => {
    for (const key of ['data', 'file']) {
      stubFetch(() => new Response(body));
      captureLog();
      const path = join(dir, `big-${key}.json`);
      await writeRunOutput(makeRun({ output: { [key]: envelope } }), path);
      expect(calls).toEqual([envelope.download_link]);
      expect(readFileSync(path, 'utf-8')).toBe(body);
      expect(existsSync(`${path}.part`)).toBe(false);
      expect(lines.join('\n')).toContain(`Output written to ${path}`);
      expect(process.exitCode ?? 0).toBe(0);
    }
  });

  it('never fetches file results, look-alikes or expired entries', async () => {
    stubFetch(() => new Response(body));
    const outputs = [
      { size: '1024x640', image: { ...envelope, content_type: 'image/png' } },
      { data: { download_link: 'https://x.example/f' } },
      { data: { expired: true, file_expired_at: envelope.file_expires_at, message: 'm' } },
    ];
    for (const [n, output] of outputs.entries()) {
      const path = join(dir, `json-${n}.json`);
      await writeRunOutput(makeRun({ output }), path, true);
      expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(output);
    }
    expect(calls).toEqual([]);
  });

  it('keeps the link and exits 1 when the download fails (human mode)', async () => {
    stubFetch(() => new Response('link not found or expired', { status: 404 }));
    captureLog();
    const path = join(dir, 'failed.json');
    await writeRunOutput(makeRun({ output: { data: envelope } }), path);
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({ data: envelope });
    expect(existsSync(`${path}.part`)).toBe(false);
    expect(lines.join('\n')).toContain("Couldn't download the response body (HTTP 404)");
    expect(lines.join('\n')).not.toContain('Output written');
    expect(process.exitCode).toBe(1);
  });

  it('reports a failed download as outputError in json mode', async () => {
    stubFetch(() => {
      throw new Error('network down');
    });
    const path = join(dir, 'failed-json.json');
    const run = makeRun({ output: { data: envelope } });
    const saved = await writeRunOutputJson(run, path);
    expect('outputError' in saved && saved.outputError.message).toContain('network down');
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({ data: envelope });
    expect(process.exitCode).toBe(1);
  });
});

describe('resolveOutputSource', () => {
  it('prefers provider data, then the error body, then stored output', () => {
    const data = { a: 1 };
    const error = { b: 2 };
    const output = { c: 3 };
    expect(resolveOutputSource({ providerResponse: { httpStatus: 200, data, error }, output }))
      .toEqual({ field: 'data', body: data });
    expect(resolveOutputSource({ providerResponse: { httpStatus: 500, error }, output }))
      .toEqual({ field: 'error', body: error });
    expect(resolveOutputSource({ providerResponse: { httpStatus: 200 }, output }))
      .toEqual({ field: 'output', body: output });
    expect(resolveOutputSource({ providerResponse: { httpStatus: 200 }, output: null })).toBeUndefined();
  });
});

describe('writeRunOutputJson after a successful write', () => {
  it('drops a legacy providerResponse.data body and keeps the rest', async () => {
    const path = join(dir, 'legacy.json');
    const output = { other: true };
    const run = makeRun({ output, providerResponse: { httpStatus: 200, data: { items: [1] } } });
    const saved = await writeRunOutputJson(run, path);
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({ items: [1] });
    const { providerResponse: _pr, ...rest } = run;
    expect(saved).toEqual({ ...rest, output, providerResponse: { httpStatus: 200 }, outputFile: path });
  });
});
