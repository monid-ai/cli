import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { handleError, MonidError, withRunContext } from '../../src/utils/error.js';
import { PollTimeoutError } from '../../src/utils/poll.js';

describe('handleError', () => {
  let exitSpy: ReturnType<typeof spyOn>;
  let errSpy: ReturnType<typeof spyOn>;
  let logSpy: ReturnType<typeof spyOn>;
  // Bun does not clear the code on `= undefined`; keep a number to restore.
  const originalExitCode = process.exitCode ?? 0;

  beforeEach(() => {
    exitSpy = spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    errSpy = spyOn(console, 'error').mockImplementation(() => {});
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errSpy.mockRestore();
    logSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  it('sets a failing exit code without calling process.exit (text mode)', () => {
    handleError(new Error('boom'));
    expect(exitSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalled();
  });

  it('sets a failing exit code without calling process.exit (json mode)', () => {
    handleError(new MonidError('X', 'bad', 500), true);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    const out = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(out.error.code).toBe('X');
  });

  it('names the run and its last status on a --wait timeout (json)', () => {
    const err = withRunContext(new PollTimeoutError(30_000, { status: 'RUNNING' }), {
      runId: 'run_abc',
      status: 'RUNNING',
    });
    handleError(err, true);
    const out = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(out.error.code).toBe('POLL_TIMEOUT');
    expect(out.error.message).toContain('Polling timed out after 30s');
    expect(out.error.runId).toBe('run_abc');
    expect(out.error.status).toBe('RUNNING');
  });

  it('names the run and how to resume it on a --wait timeout (text)', () => {
    const err = withRunContext(new PollTimeoutError(30_000, { status: 'RUNNING' }), {
      runId: 'run_abc',
      status: 'RUNNING',
    });
    handleError(err);
    const text = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(text).toContain('Run ID: run_abc (status: RUNNING)');
    expect(text).toContain('monid runs get -r run_abc');
  });

  it('does not overwrite a run id an error already carries', () => {
    const err = withRunContext(new MonidError('X', 'bad', 500, { runId: 'run_1' }), { runId: 'run_2' });
    expect(err.runId).toBe('run_1');
  });

  it('leaves errors without a run unchanged (json)', () => {
    handleError(new MonidError('NOT_FOUND', 'HTTP 404', 404), true);
    const out = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(out.error).toEqual({ code: 'NOT_FOUND', message: 'Not found: HTTP 404' });
  });

  it('does not say the run keeps going once it is terminal', () => {
    const err = withRunContext(new Error('EACCES: permission denied, open out.json'), {
      runId: 'run_done',
      status: 'COMPLETED',
    });
    handleError(err);
    const text = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(text).toContain('Run ID: run_done (status: COMPLETED)');
    expect(text).not.toContain('keeps going');
    expect(text).toContain('monid runs get -r run_done');
  });

  it('names what was rate limited and how long to wait', () => {
    handleError(new MonidError('RATE_LIMITED', 'Rate limited. Retry after 37s.', 429, { retryAfterSec: 37, limitedOn: 'tinyfish /search' }), true);
    const out = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(out.error).toEqual({ code: 'RATE_LIMITED', message: 'Rate limited on tinyfish /search. Retry after 37s.' });
  });

  it('falls back to the old rate-limit text without a label or Retry-After', () => {
    handleError(new MonidError('RATE_LIMITED', 'HTTP 429', 429), true);
    const out = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(out.error.message).toBe('Rate limited. Please try again later.');
  });

  it("shows the 'monid keys add' tip when the API says UNAUTHENTICATED", () => {
    handleError(new MonidError('UNAUTHENTICATED', 'Invalid API key', 401));
    const text = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(text).toContain("monid keys add");
  });

  it('prints the error hints under the message (text) and in --json', () => {
    const err = new MonidError('NOT_FOUND', "Endpoint '/serch' not found for provider 'tinyfish'", 404, {
      hints: { 'find the right endpoint': "monid discover -q 'tinyfish /serch'" },
    });
    handleError(err);
    const text = errSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
    expect(text).toContain('Hints');
    expect(text).toContain("monid discover -q 'tinyfish /serch'");

    handleError(err, true);
    const out = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(out.error.hints).toEqual({
      'find the right endpoint': "monid discover -q 'tinyfish /serch'",
    });
  });

  it('does not repeat the topup command when the API already sent a top-up hint', () => {
    const topup = { stripe: '/v1/wallet/topup/sessions', dashboard: 'https://app.monid.ai/wallet' };
    const withHint = new MonidError('WALLET_INSUFFICIENT_FUNDS', 'Not enough wallet balance.', 402, {
      topup,
      hints: { 'top up the wallet': 'To top up, run monid topup -a <amount> or go to https://app.monid.ai/wallet.' },
    });
    handleError(withHint);
    const text = errSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
    expect(text).not.toContain('Or run: monid topup');
    expect(text).toContain('To top up, run monid topup -a <amount>');
  });
});
