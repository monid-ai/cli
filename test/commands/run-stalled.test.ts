import { describe, it, expect, afterAll } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTRY = fileURLToPath(new URL('../../src/index.ts', import.meta.url));

// The run is created (RUNNING), then every status request is accepted and
// never answered: the shape of a run that finished server-side while the
// client's connection went quiet.
const server = Bun.serve({
  port: 0,
  idleTimeout: 0,
  fetch: (req) => {
    if (req.method === 'POST') {
      return Response.json({ runId: 'run_stalled', status: 'RUNNING' });
    }
    return new Promise<Response>(() => {});
  },
});
afterAll(() => server.stop(true));

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

describe('monid run --wait when status requests stall', () => {
  it('ends at the --wait limit and names the run, instead of hanging', async () => {
    const proc = Bun.spawn(
      [process.execPath, ENTRY, 'run', '-p', 'search1api', '-e', '/search', '-w', '2', '-j'],
      {
        env: {
          ...process.env,
          XDG_CONFIG_HOME: configHome(),
          MONID_API_BASE_URL: `http://localhost:${server.port}`,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const killer = setTimeout(() => proc.kill(), 15_000);
    const [out] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;
    clearTimeout(killer);

    expect(code).toBe(1);
    const parsed = JSON.parse(out);
    expect(parsed.error.message).toContain('Polling timed out');
    expect(parsed.error.runId).toBe('run_stalled');
  }, 20_000);
});
