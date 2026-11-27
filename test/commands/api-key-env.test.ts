import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTRY = fileURLToPath(new URL('../../src/index.ts', import.meta.url));

// Records the Authorization header of each request.
const seenAuth: (string | null)[] = [];
const server = Bun.serve({
  port: 0,
  fetch: (req) => {
    seenAuth.push(req.headers.get('x-api-key') ?? req.headers.get('authorization'));
    return Response.json({ userId: 'u', workspaceId: 'w' });
  },
});
afterAll(() => server.stop(true));

async function monid(
  args: string[],
  env: Record<string, string | undefined>,
  home: string,
  stdin?: string,
): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn([process.execPath, ENTRY, ...args], {
    env: {
      ...process.env,
      MONID_API_KEY: undefined,
      XDG_CONFIG_HOME: home,
      MONID_API_BASE_URL: `http://localhost:${server.port}`,
      ...env,
    },
    stdin: stdin === undefined ? 'ignore' : new Blob([stdin]),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, out, err };
}

const tmp = () => mkdtempSync(join(tmpdir(), 'monid-env-'));

describe('MONID_API_KEY', () => {
  it('authenticates with no stored key and never stores the key', async () => {
    const home = tmp();
    seenAuth.length = 0;
    const r = await monid(['whoami', '-j'], { MONID_API_KEY: 'monid_test_fromenv' }, home);
    expect(r.err).not.toContain('No active API key');
    expect(r.code).toBe(0);
    expect(seenAuth.join(' ')).toContain('monid_test_fromenv');
    const creds = join(home, 'monid', 'credentials.yaml');
    if (existsSync(creds)) expect(readFileSync(creds, 'utf8')).not.toContain('fromenv');
  });

  it('takes precedence over a stored active key', async () => {
    const home = tmp();
    await monid(['keys', 'add', '-l', 'main', '-k', 'monid_test_stored'], {}, home);
    seenAuth.length = 0;
    const r = await monid(['whoami', '-j'], { MONID_API_KEY: 'monid_test_fromenv' }, home);
    expect(r.code).toBe(0);
    expect(seenAuth.join(' ')).toContain('monid_test_fromenv');
    expect(seenAuth.join(' ')).not.toContain('monid_test_stored');
  });

  it('is ignored when empty, falling back to the stored key', async () => {
    const home = tmp();
    await monid(['keys', 'add', '-l', 'main', '-k', 'monid_test_stored'], {}, home);
    seenAuth.length = 0;
    const r = await monid(['whoami', '-j'], { MONID_API_KEY: '' }, home);
    expect(r.code).toBe(0);
    expect(seenAuth.join(' ')).toContain('monid_test_stored');
  });

  it('rejects a malformed value without sending a request', async () => {
    seenAuth.length = 0;
    const r = await monid(['whoami', '-j'], { MONID_API_KEY: 'nope' }, tmp());
    expect(r.code).not.toBe(0);
    expect(r.err + r.out).toContain('MONID_API_KEY');
    expect(seenAuth.length).toBe(0);
  });
});

describe('keys add without -k', () => {
  it('reads the key from piped stdin', async () => {
    const home = tmp();
    const r = await monid(['keys', 'add', '-l', 'main'], {}, home, 'monid_test_piped\n');
    expect(r.code).toBe(0);
    expect(readFileSync(join(home, 'monid', 'credentials.yaml'), 'utf8')).toContain(
      'key: monid_test_piped\n',
    );
  });
});
