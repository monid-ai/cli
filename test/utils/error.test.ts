import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { handleError, MonidError } from '../../src/utils/error.js';

describe('handleError', () => {
  let exitSpy: ReturnType<typeof spyOn>;
  let errSpy: ReturnType<typeof spyOn>;
  let logSpy: ReturnType<typeof spyOn>;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    exitSpy = spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    errSpy = spyOn(console, 'error').mockImplementation(() => {});
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
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
});
