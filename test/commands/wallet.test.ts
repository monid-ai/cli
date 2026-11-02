import { describe, it, expect, afterEach } from 'bun:test';
import { MonidAPI } from '../../src/api/client.js';
import { normalizeRedeemCode } from '../../src/commands/wallet/promo-codes/redeem.js';
import { promoCodeLabel } from '../../src/output/format.js';
import { MonidError } from '../../src/utils/error.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const api = new MonidAPI({ apiKey: 'test-key', baseUrl: 'https://api.example.test' });

/** Record the next request and answer it with `body` / `status`. */
function capture(body: unknown, status = 200) {
  const seen: { url: string; method?: string; body?: unknown }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen.push({
      url,
      method: init?.method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return seen;
}

describe('wallet promo codes', () => {
  it('lists redeemed codes from GET /v1/wallet/promo-codes with limit and cursor', async () => {
    const seen = capture({ items: [], cursor: undefined });
    await api.listPromoCodes(5, 'abc');
    expect(seen[0]?.method).toBe('GET');
    expect(seen[0]?.url).toBe('https://api.example.test/v1/wallet/promo-codes?limit=5&cursor=abc');
  });

  it('redeems with POST /v1/wallet/promo-codes/redeem { code }', async () => {
    const seen = capture({ amount: 1, currency: 'USD', balance: { value: 1, currency: 'USD' } });
    const out = await api.redeemPromoCode('MONID-SIGNUP');
    expect(seen[0]).toEqual({
      url: 'https://api.example.test/v1/wallet/promo-codes/redeem',
      method: 'POST',
      body: { code: 'MONID-SIGNUP' },
    });
    expect(out.amount).toBe(1);
  });

  it("surfaces the server's message on an already-redeemed signup credit", async () => {
    capture(
      {
        code: 409,
        message: 'This workspace has already redeemed its signup credit.',
        errorCode: 'SIGNUP_CREDIT_ALREADY_REDEEMED',
      },
      409,
    );
    const err = await api.redeemPromoCode('MONID-SIGNUP').then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(MonidError);
    expect((err as MonidError).statusCode).toBe(409);
    expect((err as MonidError).message).toBe('This workspace has already redeemed its signup credit.');
  });

  it('normalizes the code like the server and rejects empty or long codes', () => {
    expect(normalizeRedeemCode(' monid-signup ')).toBe('MONID-SIGNUP');
    expect(() => normalizeRedeemCode('   ')).toThrow('Promo code cannot be empty.');
    expect(() => normalizeRedeemCode('x'.repeat(65))).toThrow('too long');
  });

  it('labels the signup credit by name', () => {
    expect(promoCodeLabel('signup_credit', 'MONID-SIGNUP')).toBe('Signup credit (MONID-SIGNUP)');
    expect(promoCodeLabel('promo', 'WELCOME10')).toBe('WELCOME10');
  });
});
