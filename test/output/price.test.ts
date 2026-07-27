import { describe, it, expect } from 'bun:test';
import { formatPriceCompact } from '../../src/output/format.js';
import type { Price } from '../../src/api/types.js';

/** Strip ANSI color codes so assertions are stable regardless of chalk state. */
function plain(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

describe('formatPriceCompact', () => {
  it('renders a simple PER_CALL price with the new {value,currency} amount', () => {
    const p: Price = {
      type: 'PER_CALL',
      amount: { value: 0.01, currency: 'USD' },
    };
    expect(plain(formatPriceCompact(p))).toBe('$0.01/call');
  });

  it('renders a legacy bare-number amount', () => {
    const p: Price = { type: 'PER_CALL', amount: 0.02 as unknown as Price['amount'] };
    expect(plain(formatPriceCompact(p))).toBe('$0.02/call');
  });

  it('renders a nested PER_UNIT_MATRIX → PER_TOKEN amount with a per divisor', () => {
    // This is the shape the backend now returns; the old formatter rendered
    // "[object Object]" / "n/a" for it. When all variants share one price the
    // range collapses to a single amount.
    const p: Price = {
      type: 'PER_UNIT_MATRIX',
      amount: {
        type: 'PER_TOKEN',
        amount: { value: 5.6, currency: 'USD' },
        per: 1_000_000,
      },
      selectors: [{ label: 'Resolution', key: 'resolution', in: 'body' }],
      variants: [
        { when: { resolution: '480p' }, amount: { type: 'PER_TOKEN', amount: { value: 5.6, currency: 'USD' }, per: 1_000_000 } },
        { when: { resolution: '720p' }, amount: { type: 'PER_TOKEN', amount: { value: 5.6, currency: 'USD' }, per: 1_000_000 } },
      ],
    };
    const out = plain(formatPriceCompact(p));
    expect(out).toBe('$5.6 / 1M tokens');
    expect(out).not.toContain('[object Object]');
    expect(out).not.toContain('n/a');
  });

  it('renders a PER_UNIT_MATRIX with varying variant prices as a range', () => {
    const p: Price = {
      type: 'PER_UNIT_MATRIX',
      amount: {
        type: 'PER_TOKEN',
        amount: { value: 4, currency: 'USD' },
        per: 1_000_000,
      },
      selectors: [{ label: 'Resolution', key: 'resolution', in: 'body' }],
      variants: [
        { when: { resolution: '480p' }, amount: { type: 'PER_TOKEN', amount: { value: 4, currency: 'USD' }, per: 1_000_000 } },
        { when: { resolution: '720p' }, amount: { type: 'PER_TOKEN', amount: { value: 7, currency: 'USD' }, per: 1_000_000 } },
      ],
    };
    expect(plain(formatPriceCompact(p))).toBe('$4-$7 / 1M tokens');
  });

  it('renders METERED with a {unit,count} per period', () => {
    const p: Price = {
      type: 'METERED',
      amount: { value: 0.5, currency: 'USD' },
      per: { unit: 'MINUTE', count: 1 },
    };
    expect(plain(formatPriceCompact(p))).toBe('$0.5/minute');
  });

  it('degrades gracefully for unknown price types (never [object Object])', () => {
    const p: Price = {
      type: 'SOME_FUTURE_TYPE',
      amount: { value: 3, currency: 'USD' },
    };
    const out = plain(formatPriceCompact(p));
    expect(out).toBe('$3');
    expect(out).not.toContain('[object Object]');
  });

  // ── Current wire: leaf prices under `price` + top-level `default` ─────────

  it('renders the CURRENT matrix wire: `variants[].price` leaves + plain money amount', () => {
    const p: Price = {
      type: 'PER_UNIT_MATRIX',
      amount: { value: 3.5, currency: 'USD' }, // plain money now
      default: { type: 'PER_TOKEN', amount: { value: 3.5, currency: 'USD' }, per: 1_000_000 },
      selectors: [{ label: 'Resolution', key: 'resolution', in: 'body' }],
      variants: [
        { when: { resolution: '480p' }, price: { type: 'PER_TOKEN', amount: { value: 4, currency: 'USD' }, per: 1_000_000 } },
        { when: { resolution: '720p' }, price: { type: 'PER_TOKEN', amount: { value: 7, currency: 'USD' }, per: 1_000_000 } },
      ],
    };
    expect(plain(formatPriceCompact(p))).toBe('$4-$7 / 1M tokens');
  });

  it('renders CURRENT matrix PER_CALL leaves as a flat dollar range', () => {
    const p: Price = {
      type: 'PER_UNIT_MATRIX',
      amount: { value: 0.56, currency: 'USD' },
      default: { type: 'PER_CALL', amount: { value: 0.56, currency: 'USD' } },
      selectors: [{ label: 'Resolution', key: 'resolution', in: 'body' }],
      variants: [
        { when: { resolution: '768P' }, price: { type: 'PER_CALL', amount: { value: 0.28, currency: 'USD' } } },
        { when: { resolution: '1080P' }, price: { type: 'PER_CALL', amount: { value: 0.49, currency: 'USD' } } },
      ],
    };
    expect(plain(formatPriceCompact(p))).toBe('$0.28-$0.49');
  });

  it('renders PER_TOKEN character leaves with the character noun', () => {
    const p: Price = {
      type: 'PER_UNIT_MATRIX',
      amount: { value: 0.05, currency: 'USD' },
      selectors: [{ label: 'Model', key: 'model_id', in: 'body' }],
      variants: [
        { when: { model_id: 'a' }, price: { type: 'PER_TOKEN', amount: { value: 0.05, currency: 'USD' }, per: 1000, unit: 'character' } },
      ],
    };
    expect(plain(formatPriceCompact(p))).toBe('$0.05 / 1K characters');
  });

  it('renders TIERED with a PER_CALL default + gated tier as "from $X/call"', () => {
    // The Octen /search shape.
    const p: Price = {
      type: 'TIERED',
      amount: { value: 0.001, currency: 'USD' },
      default: { type: 'PER_CALL', amount: { value: 0.001, currency: 'USD' } },
      tiers: [
        {
          label: 'Full content',
          when: { 'full_content.enable': true },
          selector: { label: 'Full content', key: 'meta.usage.full_content_tokens', in: 'output' },
          price: { type: 'PER_TOKEN', amount: { value: 0.001, currency: 'USD' }, per: 1000 },
        },
      ],
    };
    expect(plain(formatPriceCompact(p))).toBe('from $0.001/call');
  });

  it('renders TIERED with a PER_RESULT default as "from $X/result"', () => {
    // The Octen /broad-search shape (billedUnits = executed sub-queries).
    const p: Price = {
      type: 'TIERED',
      amount: { value: 0.001, currency: 'USD' },
      default: { type: 'PER_RESULT', amount: { value: 0.001, currency: 'USD' } },
      tiers: [
        {
          label: 'Full content',
          when: { 'search_options.full_content.enable': true },
          price: { type: 'PER_TOKEN', amount: { value: 0.001, currency: 'USD' }, per: 1000 },
        },
      ],
    };
    expect(plain(formatPriceCompact(p))).toBe('from $0.001/result');
  });

  it('renders TIERED without a default as "varies"', () => {
    const p: Price = {
      type: 'TIERED',
      amount: { value: 0, currency: 'USD' },
      tiers: [
        {
          label: 'Deep mode',
          when: { deep: true },
          price: { type: 'PER_CALL', amount: { value: 0.01, currency: 'USD' } },
        },
      ],
    };
    const out = plain(formatPriceCompact(p));
    expect(out).toBe('varies');
    expect(out).not.toContain('[object Object]');
  });
});
