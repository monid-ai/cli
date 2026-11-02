import { describe, it, expect, spyOn } from 'bun:test';
import { WEB_BASE_URL } from '../../src/config/constants.js';
import { handleError, MonidError } from '../../src/utils/error.js';

// WEB_BASE_URL is read from MONID_WEB_BASE_URL at module load, so assert
// against the resolved constant rather than a hard-coded host: the point
// under test is that the links use the WEB host, never the API host.
const WEB = WEB_BASE_URL;

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
    expect(out).toContain(`${WEB}/access/api-keys`);
    expect(out).not.toContain('api.monid.ai/access');
  });

  it('402 points at the web dashboard wallet page', () => {
    const out = capture(new MonidError('PAYMENT_REQUIRED', 'HTTP 402', 402));
    expect(out).toContain(`${WEB}/wallet`);
    expect(out).not.toContain('api.monid.ai/wallet');
  });

  it('defaults to app.monid.ai when MONID_WEB_BASE_URL is unset', () => {
    if (process.env.MONID_WEB_BASE_URL !== undefined) return; // override in effect; covered above
    expect(WEB).toBe('https://app.monid.ai');
  });
});
