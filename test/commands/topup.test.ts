import { describe, it, expect, spyOn } from 'bun:test';
import {
  browserCommand,
  checkTopupLimits,
  fetchTopupLimits,
  formatTopupLimits,
  noTopupScopeMessage,
  parseTopupAmount,
} from '../../src/commands/topup.js';
import { webBaseUrlFor, WEB_BASE_URL } from '../../src/config/constants.js';
import { friendlyMessage, MonidError } from '../../src/utils/error.js';
import { formatBalance } from '../../src/output/format.js';
import { MonidAPI } from '../../src/api/client.js';

function capture(fn: () => void): string {
  const lines: string[] = [];
  const spy = spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    lines.push(a.map(String).join(' '));
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  // Strip ANSI colors so assertions read the plain text.
  return lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '');
}

describe('parseTopupAmount', () => {
  it('accepts a positive dollar amount, rounded to cents', () => {
    expect(parseTopupAmount(5)).toBe(5);
    expect(parseTopupAmount(12.345)).toBe(12.35);
  });

  it('rejects zero, negative, non-finite and sub-cent amounts', () => {
    for (const bad of [0, -5, 0.004, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => parseTopupAmount(bad)).toThrow(MonidError);
    }
  });
});

describe('top-up limits', () => {
  const config = {
    minAmount: 5,
    maxAmount: 1000,
    currency: 'USD',
    processingFee: { type: 'PERCENTAGE', rate: 0.05, description: 'Processing fee (5%)' },
  };

  it('rejects below the minimum, naming it and a command that works', () => {
    expect(() => checkTopupLimits(0.35, config)).toThrow(
      'Minimum top-up is $5.00 (you asked for $0.35). Try: monid topup -a 5',
    );
  });

  it('rejects above the maximum', () => {
    expect(() => checkTopupLimits(1500, config)).toThrow(
      'Maximum top-up is $1000.00 (you asked for $1500.00). Try: monid topup -a 1000',
    );
  });

  it('accepts the range ends, and any amount over the min with no max', () => {
    expect(() => checkTopupLimits(5, config)).not.toThrow();
    expect(() => checkTopupLimits(1000, config)).not.toThrow();
    expect(() => checkTopupLimits(1e6, { minAmount: 5 })).not.toThrow();
  });

  it('a failed config read never blocks the top-up', async () => {
    const forbidden = {
      getTopupConfig: () =>
        Promise.reject(new MonidError('FORBIDDEN', 'no wallet:read', 403)),
    };
    expect(await fetchTopupLimits(forbidden)).toBeUndefined();
    const ok = { getTopupConfig: () => Promise.resolve(config) };
    expect(await fetchTopupLimits(ok)).toEqual(config);
  });

  it('lists the limits and fee', () => {
    expect(formatTopupLimits(config)).toEqual([
      '  Top-up limits: minimum $5.00, maximum $1000.00 (USD)',
      '  Processing fee (5%)',
      '  Run: monid topup -a <dollars>',
    ]);
    expect(formatTopupLimits({ minAmount: 5, currency: 'USD' })[0]).toBe(
      '  Top-up limits: minimum $5.00 (USD)',
    );
  });
});

describe('browserCommand', () => {
  const url = 'https://checkout.stripe.com/c/pay?a=1&b=2^%41';

  it('opens the whole URL without a shell on every platform', () => {
    expect(browserCommand(url, 'win32')).toEqual([
      'rundll32',
      ['url.dll,FileProtocolHandler', url],
    ]);
    expect(browserCommand(url, 'darwin')).toEqual(['open', [url]]);
    expect(browserCommand(url, 'linux')).toEqual(['xdg-open', [url]]);
  });

  it('refuses anything that is not an http(s) URL', () => {
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'not a url']) {
      expect(browserCommand(bad, 'win32')).toBeUndefined();
    }
  });
});

describe('web dashboard URL', () => {
  it('maps the API host to the web app of the SAME environment', () => {
    expect(webBaseUrlFor('https://api.monid.ai')).toBe('https://app.monid.ai');
    expect(webBaseUrlFor('https://api.dev.monid.ai')).toBe(
      'https://app.dev.monid.ai',
    );
    // Unknown hosts fall back to production.
    expect(webBaseUrlFor('http://localhost:8080')).toBe('https://app.monid.ai');
  });

  it('a key without topups:create is sent to the dashboard', () => {
    expect(noTopupScopeMessage()).toBe(
      `This API key can't create a checkout link. Top up at ${WEB_BASE_URL}/wallet.`,
    );
  });
});

describe('friendlyMessage', () => {
  it('401 points at the web app, not the API host', () => {
    const msg = friendlyMessage(new MonidError('AUTH_FAILED', 'bad', 401));
    expect(msg).toContain(`${WEB_BASE_URL}/access/api-keys`);
  });

  it('402 keeps the server message and offers monid topup when the key may', () => {
    const server =
      'Not enough wallet balance: this run requires ~$0.35, but your wallet has $0. Top up at https://app.dev.monid.ai/wallet.';
    const withScope = new MonidError('PAYMENT_REQUIRED', server, 402, {
      topup: {
        stripe: '/v1/wallet/topup/sessions',
        dashboard: 'https://app.dev.monid.ai/wallet',
      },
    });
    expect(friendlyMessage(withScope)).toBe(
      `${server}\n  Or run: monid topup -a <AMOUNT>  (prints a checkout link to pay)`,
    );
    const noScope = new MonidError('PAYMENT_REQUIRED', server, 402, {
      topup: { dashboard: 'https://app.dev.monid.ai/wallet' },
    });
    expect(friendlyMessage(noScope)).toBe(server);
  });
});

describe('balance rendering', () => {
  it('formatBalance never prints a negative balance and shows held money', () => {
    const out = capture(() =>
      formatBalance({
        balance: { value: -0.12, currency: 'USD' },
        held: { value: 1.12, currency: 'USD' },
        topup: {
          stripe: '/v1/wallet/topup/sessions',
          dashboard: 'https://app.monid.ai/wallet',
        },
      }),
    );
    expect(out).toContain('Balance: $0.00 USD');
    expect(out).not.toContain('-0.12');
    expect(out).toContain('Held:    $1.12');
    expect(out).toContain('monid topup -a <AMOUNT>');
  });

  it('formatBalance still offers monid topup when only topup.stripe is present', () => {
    const out = capture(() =>
      formatBalance({
        balance: { value: 0, currency: 'USD' },
        topup: { stripe: '/v1/wallet/topup/sessions' },
      }),
    );
    expect(out).toContain(`Top up at ${WEB_BASE_URL}/wallet`);
    expect(out).toContain('monid topup -a <AMOUNT>');
  });

  it('formatBalance is quiet about top-up when the balance is positive', () => {
    const out = capture(() =>
      formatBalance({ balance: { value: 3.5, currency: 'USD' }, topup: { stripe: '/x' } }),
    );
    expect(out).toContain('Balance: $3.50 USD');
    expect(out).not.toContain('Top up');
  });
});

describe('API error envelope', () => {
  const api = new MonidAPI({ apiKey: 'k', baseUrl: 'https://api.example.test' });
  const realFetch = globalThis.fetch;
  function stub(status: number, body: unknown) {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  }

  it('propagates the documented top-level errorCode and the 402 topup hints', async () => {
    try {
      stub(402, {
        code: 402,
        message: 'Wallet has $0.00 yet run needs $0.35.',
        errorCode: 'WALLET_INSUFFICIENT_FUNDS',
        topup: { stripe: '/v1/wallet/topup/sessions', dashboard: 'https://app.dev.monid.ai/wallet' },
      });
      const err = (await api.whoami().then(() => null, (e: unknown) => e)) as MonidError;
      expect(err.code).toBe('WALLET_INSUFFICIENT_FUNDS');
      expect(err.topup?.stripe).toBe('/v1/wallet/topup/sessions');
      expect(friendlyMessage(err)).toContain('Wallet has $0.00 yet run needs $0.35.');
      expect(friendlyMessage(err)).toContain('monid topup -a <AMOUNT>');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('still derives a code from the status when the envelope has none', async () => {
    try {
      stub(404, { code: 404, message: 'Run x not found' });
      const err = (await api.getRun('x').then(() => null, (e: unknown) => e)) as MonidError;
      expect(err.code).toBe('NOT_FOUND');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
