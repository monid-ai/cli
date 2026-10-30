import { describe, it, expect, afterAll } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENTRY = new URL('../../src/index.ts', import.meta.url).pathname;

// The sync POST /v1/run answer under test, set per case.
let reply: { status: number; body: unknown } = { status: 200, body: {} };
const server = Bun.serve({
  port: 0,
  fetch: () => Response.json(reply.body, { status: reply.status }),
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

async function run(status: number, body: unknown): Promise<{ code: number; out: string }> {
  reply = { status, body };
  const proc = Bun.spawn([process.execPath, ENTRY, 'run', '-p', 'contactout', '-e', '/v1/email/verify'], {
    env: {
      ...process.env,
      XDG_CONFIG_HOME: configHome(),
      MONID_API_BASE_URL: `http://localhost:${server.port}`,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const out = await new Response(proc.stdout).text();
  return { code: await proc.exited, out };
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
    const { code, out } = await run(403, completed(403, { message: "You're out of credits", status_code: 403 }));
    expect(out).toContain('01M4Z0C45J63GV8C76P6YJRFTK');
    expect(out).toContain("You're out of credits");
    expect(code).toBe(1);
  });

  it('a timed-out run exits 1', async () => {
    const { code } = await run(408, { ...completed(200), status: 'TIMED_OUT', providerResponse: undefined });
    expect(code).toBe(1);
  });

  it('a provider 2xx exits 0', async () => {
    const { code } = await run(200, completed(200));
    expect(code).toBe(0);
  });
});
