import { describe, it, expect, afterAll } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTRY = fileURLToPath(new URL('../../src/index.ts', import.meta.url));

// The sync POST /v1/run answer under test, set per case.
let reply: { status: number; body: unknown } = { status: 200, body: {} };
// Optional answer for GET /v1/runs/:id (the --wait poll); defaults to `reply`.
let pollReply: { status: number; body: unknown } | undefined;
const server = Bun.serve({
  port: 0,
  fetch: (req) => {
    const r = req.method === 'GET' && pollReply ? pollReply : reply;
    return Response.json(r.body, { status: r.status });
  },
});
afterAll(() => server.stop(true));

/** A config dir holding one active key, with the update check fresh. */
function configHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'monid-test-'));
  mkdirSync(join(home, 'monid'));
  writeFileSync(
    join(home, 'monid', 'config.yaml'),
    `active_key: test\nlast_update_check: "${new Date().toISOString()}"\n`,
  );
  writeFileSync(
    join(home, 'monid', 'credentials.yaml'),
    'keys:\n  test:\n    key: monid_test_key\n    prefix: monid_te\n    added_at: "2026-10-27T00:00:00Z"\n',
  );
  return home;
}

async function run(
  status: number,
  body: unknown,
  ...extra: string[]
): Promise<{ code: number; out: string; err: string }> {
  reply = { status, body };
  const proc = Bun.spawn([process.execPath, ENTRY, 'run', '-p', 'contactout', '-e', '/v1/email/verify', ...extra], {
    env: {
      ...process.env,
      XDG_CONFIG_HOME: configHome(),
      MONID_API_BASE_URL: `http://localhost:${server.port}`,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, out, err };
}

// Shape of the API's sync COMPLETED body (prod run 01M4Z0C45J63GV8C76P6YJRFTK).
const completed = (httpStatus: number, error?: unknown) => ({
  runId: '01M4Z0C45J63GV8C76P6YJRFTK',
  provider: 'contactout',
  endpoint: '/v1/email/verify',
  status: 'COMPLETED',
  output: null,
  providerResponse: { httpStatus, ...(error ? { error } : {}) },
  billing: { reportedCost: { currency: 'USD', value: 0, unit: 'MICRO_DOLLAR' } },
  createdAt: '2026-10-15T05:25:47.649Z',
  completedAt: '2026-10-15T05:25:48.178Z',
});

describe('monid run: exit code of a sync run', () => {
  it('a provider refusal prints the run and its reason, and exits 1', async () => {
    const { code, out, err } = await run(403, completed(403, { message: "You're out of credits", status_code: 403 }));
    expect(out).toContain('01M4Z0C45J63GV8C76P6YJRFTK');
    expect(out).toContain("You're out of credits");
    // Not a green "Run completed" line: the spinner names the provider error.
    expect(out + err).toContain('provider error 403');
    expect(out + err).not.toMatch(/Run completed: 01M4Z/);
    expect(code).toBe(1);
  });

  it('a timed-out run exits 1', async () => {
    const { code, err } = await run(408, { ...completed(200), status: 'TIMED_OUT', providerResponse: undefined });
    expect(code).toBe(1);
    expect(err).not.toContain('monid: error'); // exit 1 by status, not by a crash
  });

  it('a provider 2xx exits 0', async () => {
    const { code } = await run(200, completed(200));
    expect(code).toBe(0);
  });

  it('a refusal reached through --wait exits 1 too', async () => {
    // POST answers 202 RUNNING (async endpoint); the poll returns the refusal.
    pollReply = { status: 200, body: completed(403, { message: 'blocked by site' }) };
    try {
      const { code, out, err } = await run(202, { ...completed(200), status: 'RUNNING', providerResponse: undefined }, '-w', '30');
      expect(out).toContain('blocked by site');
      expect(err).not.toContain('monid: error');
      expect(code).toBe(1);
    } finally {
      pollReply = undefined;
    }
  });

  it('a TIMED_OUT reached through --wait exits 1 too', async () => {
    pollReply = { status: 200, body: { ...completed(200), status: 'TIMED_OUT', providerResponse: undefined } };
    try {
      const { code, err } = await run(202, { ...completed(200), status: 'RUNNING', providerResponse: undefined }, '-w', '30');
      expect(code).toBe(1);
      expect(err).not.toContain('monid: error'); // exit 1 by status, not by a crash
    } finally {
      pollReply = undefined;
    }
  });

  it('a 2xx reached through --wait exits 0', async () => {
    pollReply = { status: 200, body: completed(200) };
    try {
      const { code } = await run(202, { ...completed(200), status: 'RUNNING', providerResponse: undefined }, '-w', '30');
      expect(code).toBe(0);
    } finally {
      pollReply = undefined;
    }
  });

  it('a FAILED run reached through --wait exits 1', async () => {
    pollReply = { status: 200, body: { ...completed(200), status: 'FAILED', providerResponse: undefined, error: 'pipeline crashed' } };
    try {
      const { code, err } = await run(202, { ...completed(200), status: 'RUNNING', providerResponse: undefined }, '-w', '30');
      expect(code).toBe(1);
      expect(err).not.toContain('monid: error');
    } finally {
      pollReply = undefined;
    }
  });

  it('a --wait timeout names the run and how to resume it, exits 1', async () => {
    // POST /v1/run and every GET /v1/runs/:id answer RUNNING; -w 1 times out
    // after the first 1 s backoff sleep. (-w 0 is falsy and means "don't wait".)
    const { code, out, err } = await run(202, { ...completed(200), status: 'RUNNING', providerResponse: undefined }, '-w', '1');
    expect(code).toBe(1);
    expect(err).toContain('Polling timed out');
    expect(err).toContain('Run ID: 01M4Z0C45J63GV8C76P6YJRFTK (status: RUNNING)');
    expect(err).toContain('monid runs get -r 01M4Z0C45J63GV8C76P6YJRFTK');
    expect(out).not.toContain('Run completed');
  });

  it('a --wait timeout in --json carries runId and status', async () => {
    const { code, out } = await run(202, { ...completed(200), status: 'RUNNING', providerResponse: undefined }, '-w', '1', '-j');
    expect(code).toBe(1);
    const parsed = JSON.parse(out);
    expect(parsed.error.code).toBe('POLL_TIMEOUT');
    expect(parsed.error.runId).toBe('01M4Z0C45J63GV8C76P6YJRFTK');
    expect(parsed.error.status).toBe('RUNNING');
  });
});
