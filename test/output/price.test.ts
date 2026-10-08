import { describe, it, expect } from 'bun:test';
import { formatPriceCompact, formatInspectResult } from '../../src/output/format.js';
import type { InspectResponse, Price } from '../../src/api/types.js';

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

/** Capture everything `formatInspectResult` writes to stdout. */
function captureInspect(data: InspectResponse): string {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    formatInspectResult(data);
  } finally {
    console.log = original;
  }
  return plain(lines.join('\n'));
}

/** The exa `/search` price card exactly as the backend sends it: a TIERED
 *  card whose single add-on tier carries NO `when` — it always applies and is
 *  metered by its `selector`. */
const UNGATED_TIER_INSPECT: InspectResponse = {
  provider: 'exa',
  providerName: 'Exa',
  endpoint: '/search',
  price: {
    type: 'TIERED',
    amount: { value: 0.01, currency: 'USD' },
    default: { type: 'PER_CALL', amount: { value: 0.01, currency: 'USD' } },
    tiers: [
      {
        label: 'Results above 10',
        selector: { label: 'Results above 10', key: 'numResults', in: 'body' },
        price: { type: 'PER_RESULT', amount: { value: 0.001, currency: 'USD' } },
      },
    ],
  },
} as unknown as InspectResponse;

describe('formatInspectResult', () => {
  it('renders a TIERED tier that has no `when` gate instead of throwing', () => {
    // Regression: `Object.entries(t.when)` threw "Cannot convert undefined or
    // null to object" and aborted the whole render right after the base price.
    const out = captureInspect(UNGATED_TIER_INSPECT);
    expect(out).toContain('Base:   $0.01 (always)');
    expect(out).toContain('+ Results above 10: $0.001 / result');
    // No dangling gate clause when there is nothing to gate on.
    expect(out).not.toContain('when undefined');
    expect(out).not.toMatch(/when\s*$/m);
  });

  it('still renders the gate for a tier that has one', () => {
    const gated = {
      ...UNGATED_TIER_INSPECT,
      price: {
        ...UNGATED_TIER_INSPECT.price,
        tiers: [
          {
            label: 'Deep mode',
            when: { deep: true },
            price: { type: 'PER_CALL', amount: { value: 0.05, currency: 'USD' } },
          },
        ],
      },
    } as unknown as InspectResponse;
    expect(captureInspect(gated)).toContain('+ Deep mode: $0.05 when deep=true');
  });

  it('renders a PER_UNIT_MATRIX variant that has no `when` instead of throwing', () => {
    const matrix = {
      ...UNGATED_TIER_INSPECT,
      price: {
        type: 'PER_UNIT_MATRIX',
        amount: { value: 0.02, currency: 'USD' },
        variants: [
          { price: { type: 'PER_CALL', amount: { value: 0.02, currency: 'USD' } }, label: 'flat' },
        ],
      },
    } as unknown as InspectResponse;
    const out = captureInspect(matrix);
    expect(out).toContain('- $0.02 (flat)');
    // No orphaned "key=value:" separator when there are no coordinates.
    expect(out).not.toMatch(/^\s+- :/m);
  });
});
