import { describe, it, expect, spyOn } from 'bun:test';
import {
  noTopupScopeMessage,
  parseTopupAmount,
} from '../../src/commands/topup.js';
import { webBaseUrlFor, WEB_BASE_URL } from '../../src/config/constants.js';
import { friendlyMessage, MonidError } from '../../src/utils/error.js';
import {
  formatBalance,
  formatMonetary,
  formatRunDetail,
} from '../../src/output/format.js';
import type { RunDetailResponse } from '../../src/api/types.js';

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

  it('rejects zero, negative and non-finite amounts', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => parseTopupAmount(bad)).toThrow(MonidError);
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
      stripe: '/v1/wallet/topup/sessions',
      dashboard: 'https://app.dev.monid.ai/wallet',
    });
    expect(friendlyMessage(withScope)).toBe(
      `${server}\n  Or run: monid topup -a <AMOUNT>  (prints a checkout link to pay)`,
    );
    const noScope = new MonidError('PAYMENT_REQUIRED', server, 402, {
      dashboard: 'https://app.dev.monid.ai/wallet',
    });
    expect(friendlyMessage(noScope)).toBe(server);
  });
});

describe('money rendering', () => {
  it('formatMonetary accepts the dollar number the API sends, never negative', () => {
    expect(formatMonetary(0.35)).toBe('$0.35 USD');
    expect(formatMonetary({ value: 2, currency: 'USD' })).toBe('$2.00 USD');
    expect(formatMonetary(-0.12)).toBe('$0.00 USD');
    expect(formatMonetary(undefined)).toBe('-');
  });

  it('a wallet-blocked run shows balance, held, available and required', () => {
    const run = {
      runId: '01M5C6ZH6AT505SG2ADPPN9DMR',
      provider: 'bytedance',
      endpoint: '/v1/video/seedance-2.0',
      status: 'BLOCKED',
      price: { type: 'PER_CALL', amount: 0.35, currency: 'USD' },
      createdAt: '2026-10-20T08:31:22.749Z',
      controls: [{
        controlId: 'WALLET_BALANCE',
        controlType: 'WORKSPACE_WALLET_BALANCE',
        requiredAmount: 0.35,
        snapshot: {
          type: 'WORKSPACE_WALLET_BALANCE',
          limitAmount: 0,
          availableAmount: 0,
          heldAmount: 0,
        },
      }],
    } as unknown as RunDetailResponse;
    const out = capture(() => formatRunDetail(run));
    expect(out).toContain('Wallet Balance');
    expect(out).toContain('Available: $0.00 USD');
    expect(out).toContain('Required:  $0.35 USD');
  });

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
});
