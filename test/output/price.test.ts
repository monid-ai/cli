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
});
