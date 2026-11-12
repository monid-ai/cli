import { describe, it, expect } from 'bun:test';
import { formatDiscoverResults, formatInspectResult } from '../../src/output/format.js';
import type {
  Alternative,
  DiscoverResponse,
  DiscoverResult,
  InspectResponse,
  Price,
} from '../../src/api/types.js';

/** Strip ANSI color codes so assertions are stable regardless of chalk state. */
function plain(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

function capture(fn: () => void): string {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(' '));
  };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return plain(lines.join('\n'));
}

const perCall = (value: number) =>
  ({ type: 'PER_CALL', amount: { value, currency: 'USD' } }) as unknown as Price;

function result(r: Partial<DiscoverResult>): DiscoverResult {
  return {
    provider: 'tinyfish',
    providerName: 'TinyFish',
    endpoint: '/search',
    description: 'Search the live web.',
    price: perCall(0.005),
    score: 0.9,
    tags: ['no-markup'],
    ...r,
  };
}

const freeTier: Alternative = {
  endpoint: '/free/search',
  label: 'Free tier',
  tags: ['free'],
  price: perCall(0),
  limits: '30/min, 500/hour per workspace.',
};

const discover = (results: DiscoverResult[], hints?: Record<string, string>): DiscoverResponse => ({
  query: 'q',
  count: results.length,
  results,
  ...(hints ? { hints } : {}),
});

/** The table line holding `needle`. */
const lineWith = (out: string, needle: string) =>
  out.split('\n').find((l) => l.includes(needle)) ?? '';

describe('discover: alternatives under their result', () => {
  it('indents each alternative under its result, last one with └', () => {
    const promo: Alternative = {
      endpoint: '/promo/search',
      label: '50% off',
      tags: ['promotion'],
      price: perCall(0.0025),
      limits: '5/min per workspace.',
    };
    const out = capture(() =>
      formatDiscoverResults(discover([result({ alternatives: [promo, freeTier] }), result({ endpoint: '/fetch' })])),
    );
    const lines = out.split('\n');
    const at = (s: string) => lines.findIndex((l) => l.includes(s));
    expect(at('/search ')).toBeLessThan(at('├ /promo/search'));
    expect(at('├ /promo/search')).toBeLessThan(at('└ /free/search'));
    expect(at('└ /free/search')).toBeLessThan(at('/fetch'));
    expect(lineWith(out, '├ /promo/search')).toContain('[50% off] 5/min per workspace.');
    expect(lineWith(out, '└ /free/search')).toContain('$0/call');
    expect(lineWith(out, '└ /free/search')).toContain('[Free tier] 30/min, 500/hour per workspace.');
    // Indented: the provider cell of an alternative row is empty.
    expect(lineWith(out, '└ /free/search').startsWith('tinyfish')).toBe(false);
  });

  it('a seated offer shows [label] and its limits; the regular price row has no brackets', () => {
    const out = capture(() =>
      formatDiscoverResults(
        discover([
          result({
            provider: 'mrscraper',
            endpoint: '/promo/amazon/product',
            description: 'Scrape an Amazon product page.',
            tags: ['promotion'],
            label: '50% off',
            limits: '5/min, 50/hour, 150/day per workspace.',
            price: perCall(0.025),
            alternatives: [
              { endpoint: '/amazon/product', label: 'Regular price', tags: ['no-markup'], price: perCall(0.05) },
            ],
          }),
        ]),
      ),
    );
    expect(lineWith(out, '/promo/amazon/product')).toContain('[50% off] Scrape an Amazon product page.');
    expect(out).toContain('5/min, 50/hour, 150/day per workspace.');
    const regular = lineWith(out, '└ /amazon/product');
    expect(regular).toContain('Regular price');
    expect(regular).not.toContain('[');
    expect(regular).toContain('$0.05/call');
  });

  it('never truncates long limits: they wrap', () => {
    const limits =
      "5/min, 10/hour, 20/day per workspace. Turbo voice only (lower quality); up to 1,000 characters per run; HeyGen's free capacity is shared, so it may answer 429. Through 2026-11-30.";
    const out = capture(() =>
      formatDiscoverResults(
        discover([
          result({
            alternatives: [{ endpoint: '/promo/tts', label: 'Free Turbo voice', tags: ['promotion'], price: perCall(0), limits }],
          }),
        ]),
      ),
    );
    const words = out.replace(/\s+/g, ' ');
    expect(words).toContain('may answer 429. Through 2026-11-30.');
    expect(out).not.toContain('2026-11-...');
  });

  it('drops the results[].alternatives hint (the rows show it), keeps other hints', () => {
    const out = capture(() =>
      formatDiscoverResults(
        discover([result({ alternatives: [freeTier] })], {
          'results[].alternatives': 'same endpoint, different price, limits or terms',
          'try this': 'monid discover -q x',
        }),
      ),
    );
    expect(out).not.toContain('results[].alternatives');
    expect(out).toContain('try this: monid discover -q x');
  });

  it('prints no Hints block when only the alternatives hint was sent', () => {
    const out = capture(() =>
      formatDiscoverResults(
        discover([result({ alternatives: [freeTier] })], {
          'results[].alternatives': 'same endpoint, different price, limits or terms',
        }),
      ),
    );
    expect(out).not.toContain('Hints');
  });

  it('a result without alternatives renders one row, as before', () => {
    const out = capture(() => formatDiscoverResults(discover([result({})])));
    expect(out).not.toContain('└');
    expect(out).not.toContain('├');
    expect(out.split('\n').filter((l) => l.includes('tinyfish'))).toHaveLength(1);
  });
});

describe('inspect: Offer and Alternatives', () => {
  const base: InspectResponse = {
    id: 'x',
    provider: 'tinyfish',
    providerName: 'TinyFish',
    endpoint: '/free/search',
    description: 'Search the live web.',
    price: perCall(0),
  };

  it('an offer shows its label, limits, regular endpoint and regular price', () => {
    const out = capture(() =>
      formatInspectResult({
        ...base,
        offer: {
          label: '50% off',
          limits: '5/min per workspace.',
          regularEndpoint: '/search',
          listPrice: perCall(0.05),
        },
      }),
    );
    expect(out).toContain('Offer');
    expect(out).toContain('50% off — 5/min per workspace.');
    expect(out).toContain('Regular endpoint: /search');
    expect(out).toContain('Regular price: $0.05/call');
  });

  it('an offer without regular endpoint or list price prints only its label line', () => {
    const out = capture(() => formatInspectResult({ ...base, offer: { label: 'Free tier' } }));
    expect(out).toContain('Free tier');
    expect(out).not.toContain('Regular endpoint');
    expect(out).not.toContain('Regular price');
  });

  it('lists the alternatives', () => {
    const out = capture(() =>
      formatInspectResult({ ...base, endpoint: '/search', price: perCall(0.005), alternatives: [freeTier] }),
    );
    expect(out).toContain('Alternatives');
    expect(lineWith(out, '/free/search')).toContain('[Free tier] 30/min, 500/hour per workspace.');
  });

  it('neither section without offer data', () => {
    const out = capture(() => formatInspectResult(base));
    expect(out).not.toContain('Offer');
    expect(out).not.toContain('Alternatives');
  });
});
