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
      it(`accepts ${flag} and writes provider data${json ? ' with JSON stdout' : ''}`, async () => {
        const data = { items: [1, 2] };
        const result = response({ providerResponse: { httpStatus: 200, data } });
        getRun.mockResolvedValue(result);

        await cli.parse(['runs', 'get', '-r', 'run-a', flag, outputPath, ...(json ? ['--json'] : [])]);

        expect(getRun).toHaveBeenCalledWith('run-a');
        expect(getRun).toHaveBeenCalledTimes(1);
        expect(readFileSync(outputPath, 'utf-8')).toBe(JSON.stringify(data, null, 2));
        if (json) expect(JSON.parse(stdout())).toEqual(result);
        else expect(stdout()).toContain(`Output written to ${outputPath}`);
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
      const result = response({ status: 'RUNNING', providerResponse: { httpStatus: 200, data } });
      run.mockResolvedValue(result);

      await cli.parse(['run', '-p', 'apify', '-e', '/tweets', '-o', outputPath, ...(json ? ['--json'] : [])]);

      expect(getRun).not.toHaveBeenCalled();
      expect(JSON.parse(readFileSync(outputPath, 'utf-8'))).toEqual(data);
      if (json) expect(JSON.parse(stdout())).toEqual(result);
      else {
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
    run.mockResolvedValue(response({ providerResponse: { httpStatus: 200, data: { items: [6] } } }));

    await cli.parse(['run', '-p', 'apify', '-e', '/tweets', '-o', outputPath, '--json']);

    expect(getRun).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(outputPath, 'utf-8'))).toEqual({ items: [6] });
    expect(JSON.parse(stdout()).status).toBe('COMPLETED');
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
      const result = response({ status, providerResponse: { httpStatus: 200, data } });
      run.mockResolvedValue(result);
      getRun.mockResolvedValue(result);
      const missingPath = join(dir, 'missing', 'out.json');

      await cli.parse([...args, '-o', missingPath, '--json']);

      const parsed = JSON.parse(stdout());
      expect(parsed.runId).toBe('run-a');
      expect(parsed.outputError.path).toBe(missingPath);
      expect(parsed.outputError.message).toContain('ENOENT');
      expect(process.exitCode).toBe(1);
      expect(existsSync(missingPath)).toBe(false);
    });
  }
});
