import { afterEach, beforeEach, describe, expect, it, mock, spyOn, type Mock } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from '@cliffy/command';
import { MonidAPI } from '../../src/api/client.js';
import { disputeCommand } from '../../src/commands/dispute.js';
import { feedbackCommand } from '../../src/commands/feedback.js';
import { runsCommand } from '../../src/commands/runs/index.js';
import { stopSpinner } from '../../src/output/spinner.js';

// Commands whose result is only an ID or a confirmation must still print it
// when stderr is not a terminal (agents, redirects), where the spinner is silent.

const cli = new Command().name('monid').throwErrors()
  .command('feedback', feedbackCommand)
  .command('dispute', disputeCommand)
  .command('runs', runsCommand);
const savedConfigHome = process.env.XDG_CONFIG_HOME;
const savedTTY = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
let dir: string;
let logs: Mock<typeof console.log>;
let stderr: Mock<typeof process.stderr.write>;

/** stdout as console.log would print it, without ANSI colors. */
function stdout(): string {
  return logs.mock.calls
    .map((args) => args.join(' '))
    .join('\n')
    .replace(/\x1b\[[0-9;]*m/g, '');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'monid-result-output-'));
  process.env.XDG_CONFIG_HOME = dir;
  const configDir = join(dir, 'monid');
  mkdirSync(configDir);
  // A fresh cache prevents the real config constructor from checking npm.
  writeFileSync(join(configDir, 'config.yaml'),
    `active_key: test\nlast_update_check: "${new Date().toISOString()}"\n`);
  writeFileSync(join(configDir, 'credentials.yaml'),
    'keys:\n  test:\n    key: test-key\n    prefix: test\n    added_at: "2026-10-26T00:00:00.000Z"\n');
  Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true });
  logs = spyOn(console, 'log').mockImplementation(() => {});
  stderr = spyOn(process.stderr, 'write').mockImplementation(() => true);
  spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`Unexpected process.exit(${code})`);
  });
});

afterEach(() => {
  stopSpinner();
  mock.restore();
  if (savedTTY) Object.defineProperty(process.stderr, 'isTTY', savedTTY);
  else delete (process.stderr as { isTTY?: boolean }).isTTY;
  if (savedConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = savedConfigHome;
  rmSync(dir, { recursive: true, force: true });
});

describe('result output with non-terminal stderr', () => {
  it('monid feedback prints the feedback ID on stdout', async () => {
    spyOn(MonidAPI.prototype, 'sendFeedback').mockResolvedValue({
      feedbackId: 'fb_123', createdAt: '2026-11-09T00:00:00.000Z',
    });
    await cli.parse(['feedback', '-t', 'discover worked well']);
    expect(stdout()).toContain('Feedback ID: fb_123');
    expect(stderr).not.toHaveBeenCalled();
  });

  it('monid dispute prints the dispute ID on stdout', async () => {
    spyOn(MonidAPI.prototype, 'sendDispute').mockResolvedValue({
      disputeId: 'dp_123', createdAt: '2026-11-09T00:00:00.000Z',
    });
    await cli.parse(['dispute', '-r', 'run-a', '--reason', 'empty output', '-u', 'latest posts']);
    expect(stdout()).toContain('Dispute ID: dp_123');
    expect(stderr).not.toHaveBeenCalled();
  });

  it('monid runs stop prints the run and its status on stdout', async () => {
    spyOn(MonidAPI.prototype, 'stopRun').mockResolvedValue({
      runId: 'run-a', status: 'RUNNING',
    });
    await cli.parse(['runs', 'stop', 'run-a']);
    expect(stdout()).toContain('Run ID: run-a');
    expect(stdout()).toContain('Status:');
    expect(stderr).not.toHaveBeenCalled();
  });
});
