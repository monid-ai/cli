import { afterEach, beforeEach, describe, expect, it, mock, spyOn, type Mock } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from '@cliffy/command';
import { MonidAPI } from '../../src/api/client.js';
import type { RunDetailResponse, RunResponse } from '../../src/api/types.js';
import { runCommand } from '../../src/commands/run.js';
import { runsCommand } from '../../src/commands/runs/index.js';
import { stopSpinner } from '../../src/output/spinner.js';

const cli = new Command().name('monid').throwErrors()
  .command('run', runCommand)
  .command('runs', runsCommand);
const savedConfigHome = process.env.XDG_CONFIG_HOME;
let dir: string;
let outputPath: string;
let logs: Mock<typeof console.log>;
let run: Mock<MonidAPI['run']>;
let getRun: Mock<MonidAPI['getRun']>;

/** Build a real response shape without requiring a live provider or credentials. */
function response(overrides: Partial<RunDetailResponse> = {}): RunDetailResponse {
  return {
    runId: 'run-a', caller: 'caller', provider: 'apify', endpoint: '/tweets',
    status: 'COMPLETED', price: { type: 'PER_CALL', amount: 0 },
    createdAt: '2026-10-26T00:00:00.000Z',
    ...overrides,
  };
}

/** Collect stdout exactly as console.log would separate each call. */
function stdout(): string {
  return logs.mock.calls.map((args) => args.join(' ')).join('\n');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'monid-command-output-'));
  outputPath = join(dir, "saved run's output.json");
  process.env.XDG_CONFIG_HOME = dir;
  const configDir = join(dir, 'monid');
  mkdirSync(configDir);
  // A fresh cache prevents the real config constructor from checking npm.
  writeFileSync(join(configDir, 'config.yaml'),
    `active_key: test\nlast_update_check: "${new Date().toISOString()}"\n`);
  writeFileSync(join(configDir, 'credentials.yaml'),
    'keys:\n  test:\n    key: test-key\n    prefix: test\n    added_at: "2026-10-26T00:00:00.000Z"\n');
  logs = spyOn(console, 'log').mockImplementation(() => {});
  spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Unexpected process.exit(${code})`);
  });
  run = spyOn(MonidAPI.prototype, 'run').mockRejectedValue(new Error('Unexpected run request'));
  getRun = spyOn(MonidAPI.prototype, 'getRun').mockRejectedValue(new Error('Unexpected polling'));
});

afterEach(() => {
  stopSpinner();
  // A failed JSON-mode write sets the exit code; keep it from failing the test run.
  process.exitCode = 0;
  mock.restore();
  if (savedConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = savedConfigHome;
  rmSync(dir, { recursive: true, force: true });
});

describe('runs get output options', () => {
  for (const flag of ['-o', '--output']) {
    for (const json of [false, true]) {
      it(`accepts ${flag} and writes the run output${json ? ' with JSON stdout' : ''}`, async () => {
        const data = { items: [1, 2] };
        const result = response({ output: data, providerResponse: { httpStatus: 200 } });
        getRun.mockResolvedValue(result);

        await cli.parse(['runs', 'get', '-r', 'run-a', flag, outputPath, ...(json ? ['--json'] : [])]);

        expect(getRun).toHaveBeenCalledWith('run-a');
        expect(getRun).toHaveBeenCalledTimes(1);
        expect(readFileSync(outputPath, 'utf-8')).toBe(JSON.stringify(data, null, 2));
        if (json) {
          // The saved body stays out of stdout; the file path replaces it.
          const { output: _saved, ...rest } = result;
          expect(JSON.parse(stdout())).toEqual({ ...rest, outputFile: outputPath });
        } else expect(stdout()).toContain(`Output written to ${outputPath}`);
      });
    }
  }

  for (const json of [false, true]) {
    it(`leaves the file absent for a running response${json ? ' in JSON mode' : ''}`, async () => {
      const result = response({ status: 'RUNNING' });
      getRun.mockResolvedValue(result);

      await cli.parse(['runs', 'get', '-r', 'run-a', '-o', outputPath, ...(json ? ['--json'] : [])]);

      expect(existsSync(outputPath)).toBe(false);
      if (json) expect(JSON.parse(stdout())).toEqual(result);
      else expect(stdout()).toContain(`No output to write to ${outputPath} (status: RUNNING).`);
    });
  }

  it('saves the result fetched with --wait', async () => {
    getRun.mockResolvedValue(response({ output: { items: [3] } }));

    await cli.parse(['runs', 'get', '-r', 'run-a', '-w', '-o', outputPath, '--json']);

    expect(JSON.parse(readFileSync(outputPath, 'utf-8'))).toEqual({ items: [3] });
    expect(JSON.parse(stdout()).status).toBe('COMPLETED');
  });
});

describe('run output before returning', () => {
  for (const json of [false, true]) {
    it(`handles missing output without polling${json ? ' in JSON mode' : ''}`, async () => {
      const result: RunResponse = response({ status: 'RUNNING' });
      run.mockResolvedValue(result);

      await cli.parse(['run', '-p', 'apify', '-e', '/tweets', '-o', outputPath, ...(json ? ['--json'] : [])]);

      expect(run).toHaveBeenCalledTimes(1);
      expect(getRun).not.toHaveBeenCalled();
      expect(existsSync(outputPath)).toBe(false);
      if (json) expect(JSON.parse(stdout())).toEqual(result);
      else {
        expect(stdout()).toContain(`No output to write to ${outputPath} (status: RUNNING).`);
        expect(stdout()).toContain(`monid runs get -r 'run-a' -w -o '${outputPath.replace(/'/g, "'\\''")}'`);
      }
    });

    it(`writes available provider output without polling${json ? ' in JSON mode' : ''}`, async () => {
      const data = { items: [4] };
      const result = response({ status: 'RUNNING', output: data, providerResponse: { httpStatus: 200 } });
      run.mockResolvedValue(result);

      await cli.parse(['run', '-p', 'apify', '-e', '/tweets', '-o', outputPath, ...(json ? ['--json'] : [])]);

      expect(getRun).not.toHaveBeenCalled();
      expect(JSON.parse(readFileSync(outputPath, 'utf-8'))).toEqual(data);
      if (json) {
        const { output: _saved, ...rest } = result;
        expect(JSON.parse(stdout())).toEqual({ ...rest, outputFile: outputPath });
      } else {
        expect(stdout()).toContain(`Output written to ${outputPath}`);
        expect(stdout()).not.toContain('monid runs get');
      }
    });
  }

  it('keeps runs without -o free of file-saving notices', async () => {
    run.mockResolvedValue(response({ status: 'RUNNING' }));

    await cli.parse(['run', '-p', 'apify', '-e', '/tweets']);

    expect(getRun).not.toHaveBeenCalled();
    expect(stdout()).not.toContain('No output to write');
    expect(stdout()).not.toContain('monid runs get');
  });

  it('still polls and writes completed output with --wait', async () => {
    run.mockResolvedValue(response({ status: 'RUNNING' }));
    getRun.mockResolvedValue(response({ output: { items: [5] } }));

    await cli.parse(['run', '-p', 'apify', '-e', '/tweets', '-w', '-o', outputPath, '--json']);

    expect(getRun).toHaveBeenCalledWith('run-a');
    expect(JSON.parse(readFileSync(outputPath, 'utf-8'))).toEqual({ items: [5] });
    expect(JSON.parse(stdout()).status).toBe('COMPLETED');
  });

  it('still writes synchronous results without polling', async () => {
    run.mockResolvedValue(response({ output: { items: [6] }, providerResponse: { httpStatus: 200 } }));

    await cli.parse(['run', '-p', 'apify', '-e', '/tweets', '-o', outputPath, '--json']);

    expect(getRun).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(outputPath, 'utf-8'))).toEqual({ items: [6] });
    expect(JSON.parse(stdout()).status).toBe('COMPLETED');
  });
});

// Shapes as the API sends them: the body is the top-level `output` (the wire
// schema strips `providerResponse.data`); a provider error body is in
// `providerResponse.error` with `output: null`.
describe('JSON stdout when the file was written', () => {
  const big = 'x'.repeat(100_000);
  const commands = [
    { name: 'run', args: ['run', '-p', 'apify', '-e', '/tweets'] },
    { name: 'runs get', args: ['runs', 'get', '-r', 'run-a'] },
  ];

  for (const { name, args } of commands) {
    it(`${name}: leaves a saved body out of stdout and names the file`, async () => {
      const result = response({ output: { html: big }, providerResponse: { httpStatus: 200 } });
      run.mockResolvedValue(result);
      getRun.mockResolvedValue(result);

      await cli.parse([...args, '-o', outputPath, '--json']);

      expect(JSON.parse(readFileSync(outputPath, 'utf-8'))).toEqual({ html: big });
      expect(stdout()).not.toContain(big);
      const { output: _saved, ...rest } = result;
      expect(JSON.parse(stdout())).toEqual({ ...rest, outputFile: outputPath });
      expect(process.exitCode ?? 0).toBe(0);
    });

    it(`${name}: keeps a provider error body on stdout and in the file`, async () => {
      const error = { message: 'forbidden' };
      const result = response({ output: null, providerResponse: { httpStatus: 403, error } });
      run.mockResolvedValue(result);
      getRun.mockResolvedValue(result);

      await cli.parse([...args, '-o', outputPath, '--json']);

      expect(JSON.parse(readFileSync(outputPath, 'utf-8'))).toEqual(error);
      expect(JSON.parse(stdout())).toEqual({ ...result, outputFile: outputPath });
      // A refused sync run fails scripts; reading a run that was refused does not.
      expect(process.exitCode ?? 0).toBe(name === 'run' ? 1 : 0);
    });
  }

  it('leaves a downloaded overflow body out of stdout, link included', async () => {
    const link = { download_link: 'https://sfs.monid.ai/tok', content_type: 'application/json',
      link_expires_at: '2026-11-09T13:00:00.000Z' };
    const result = response({ output: { data: link }, providerResponse: { httpStatus: 200 } });
    run.mockResolvedValue(result);
    spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ html: big })));

    await cli.parse(['run', '-p', 'apify', '-e', '/tweets', '-o', outputPath, '--json']);

    expect(JSON.parse(readFileSync(outputPath, 'utf-8'))).toEqual({ html: big });
    const { output: _saved, ...rest } = result;
    expect(JSON.parse(stdout())).toEqual({ ...rest, outputFile: outputPath });
  });

  it('keeps the overflow link on stdout when its download fails', async () => {
    const link = { download_link: 'https://sfs.monid.ai/tok', content_type: 'application/json',
      link_expires_at: '2026-11-09T13:00:00.000Z' };
    const result = response({ output: { data: link }, providerResponse: { httpStatus: 200 } });
    run.mockResolvedValue(result);
    spyOn(globalThis, 'fetch').mockResolvedValue(new Response('gone', { status: 500 }));

    await cli.parse(['run', '-p', 'apify', '-e', '/tweets', '-o', outputPath, '--json']);

    expect(JSON.parse(readFileSync(outputPath, 'utf-8'))).toEqual({ data: link });
    const { outputError, ...parsed } = JSON.parse(stdout());
    expect(parsed).toEqual(result);
    expect(outputError).toEqual({ path: outputPath, message: expect.stringContaining('HTTP 500') });
    expect(process.exitCode).toBe(1);
  });

  it('prints a terminal run with no body unchanged and writes nothing', async () => {
    const result = response({ status: 'TIMED_OUT', output: null, providerResponse: {} as never });
    run.mockResolvedValue(result);

    await cli.parse(['run', '-p', 'apify', '-e', '/tweets', '-o', outputPath, '--json']);

    expect(existsSync(outputPath)).toBe(false);
    expect(JSON.parse(stdout())).toEqual(result);
    expect(process.exitCode).toBe(1);
  });

  it('still prints the full run without -o', async () => {
    const result = response({ output: { html: 'small' }, providerResponse: { httpStatus: 200 } });
    run.mockResolvedValue(result);
    await cli.parse(['run', '-p', 'apify', '-e', '/tweets', '--json']);
    expect(JSON.parse(stdout())).toEqual(result);
  });
});

describe('JSON stdout when the file cannot be written', () => {
  const data = { items: [7] };
  const cases = [
    { name: 'runs get', args: ['runs', 'get', '-r', 'run-a'], status: 'COMPLETED' as const },
    { name: 'runs get --wait', args: ['runs', 'get', '-r', 'run-a', '-w'], status: 'COMPLETED' as const },
    { name: 'run', args: ['run', '-p', 'apify', '-e', '/tweets'], status: 'COMPLETED' as const },
    { name: 'run without --wait', args: ['run', '-p', 'apify', '-e', '/tweets'], status: 'RUNNING' as const },
  ];

  for (const { name, args, status } of cases) {
    it(`keeps ${name} to one document with the run ID and the write error`, async () => {
      const result = response({ status, output: data, providerResponse: { httpStatus: 200 } });
      run.mockResolvedValue(result);
      getRun.mockResolvedValue(result);
      const missingPath = join(dir, 'missing', 'out.json');

      await cli.parse([...args, '-o', missingPath, '--json']);

      // Nothing reached the file, so stdout keeps the body: it is the only copy.
      const { outputError, ...parsed } = JSON.parse(stdout());
      expect(parsed).toEqual(result);
      expect(outputError.path).toBe(missingPath);
      expect(outputError.message).toContain('ENOENT');
      expect(process.exitCode).toBe(1);
      expect(existsSync(missingPath)).toBe(false);
    });
  }
});
