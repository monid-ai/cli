import { describe, it, expect, spyOn } from 'bun:test';
import { handleError, MonidError } from '../../src/utils/error.js';

// The dashboard (keys, wallet) lives on app.monid.ai, not on the API host.
// Pointing users at api.monid.ai/access/api-keys gave them a 404.
describe('handleError dashboard links', () => {
  function capture(err: MonidError): string {
    const lines: string[] = [];
    const log = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.join(' '));
    });
    // handleError ends the process; neutralize that for the test.
    const exit = spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    try {
      handleError(err, true);
    } finally {
      log.mockRestore();
      exit.mockRestore();
    }
    return lines.join('\n');
  }

  it('401 points at the web dashboard key page', () => {
    const out = capture(new MonidError('AUTH_FAILED', 'HTTP 401', 401));
    expect(out).toContain('https://app.monid.ai/access/api-keys');
    expect(out).not.toContain('api.monid.ai/access');
  });

  it('402 points at the web dashboard wallet page', () => {
    const out = capture(new MonidError('PAYMENT_REQUIRED', 'HTTP 402', 402));
    expect(out).toContain('https://app.monid.ai/wallet');
    expect(out).not.toContain('api.monid.ai/wallet');
  });
});
