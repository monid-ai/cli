// TZ is pinned BEFORE any Date formatting so assertions are deterministic
// regardless of the machine running the tests (bun/node honor process.env.TZ
// on POSIX for subsequent Date operations).
process.env.TZ = 'America/Los_Angeles';

import { describe, it, expect } from 'bun:test';
import { formatDate, formatInspectResult } from '../../src/output/format.js';
import type { InspectResponse } from '../../src/api/types.js';

describe('formatDate', () => {
  it('renders local date WITH time (timezone shift is visible, not silent)', () => {
    // 02:00 UTC on Jul 14 IS Jul 13 in Los Angeles — that's correct local
    // rendering, and the included time makes it unambiguous (the old
    // date-only render looked like a wrong-day bug).
    const out = formatDate('2026-07-14T02:00:00.000Z');
    expect(out).toContain('Jul 13, 2026');
    expect(out).toMatch(/\d{1,2}:\d{2}/); // time-of-day present
    expect(out).toContain('PM'); // 19:00 local
  });

  it('keeps the local calendar day when no shift applies', () => {
    const out = formatDate('2026-07-14T20:00:00.000Z'); // 13:00 in LA
    expect(out).toContain('Jul 14, 2026');
    expect(out).toMatch(/\d{1,2}:\d{2}/);
  });

  it('distinguishes Created vs Completed on the same day (time not dropped)', () => {
    const created = formatDate('2026-07-14T23:51:03.193Z');
    const completed = formatDate('2026-07-14T23:51:17.903Z');
    // Same minute here — but a run spanning minutes must never collapse:
    const later = formatDate('2026-07-14T23:59:00.000Z');
    expect(created).not.toBe(later);
    expect(created.slice(0, 12)).toBe(completed.slice(0, 12)); // same day
  });

  it('falls back to the raw input for unparseable dates (never "Invalid Date")', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
    expect(formatDate('')).toBe('');
  });
});

// Ungated tiers (`when` absent) are covered by test/output/price.test.ts;
// these are the shapes that PR left out: an explicit null gate, a null
// price card, and null input param groups.
describe('formatInspectResult tolerates missing fields', () => {
  const base = {
    id: 'x',
    provider: 'p',
    providerName: 'P',
    endpoint: '/e',
    description: 'Desc',
  };

  function render(data: unknown): string {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => {
      lines.push(a.join(' '));
    };
    try {
      formatInspectResult(data as InspectResponse);
    } finally {
      console.log = orig;
    }
    return lines.join('\n');
  }

  it('PER_UNIT_MATRIX variant with null `when`', () => {
    const out = render({
      ...base,
      price: {
        type: 'PER_UNIT_MATRIX',
        amount: { type: 'PER_CALL', amount: '0.01', currency: 'USD' },
        variants: [{ when: null, label: 'Cell', price: { type: 'PER_CALL', amount: '0.01', currency: 'USD' } }],
      },
    });
    expect(out).toContain('Cell');
    // No dangling "null:" or empty ": " gate prefix before the amount.
    expect(out).not.toContain('null');
    expect(out).not.toMatch(/-\s*:/);
  });

  it('null price still renders the rest', () => {
    const out = render({ ...base, price: null, inputSchema: { a: 1 } });
    expect(out).toContain('Pricing');
    expect(out).toContain('Not available.');
    expect(out).toContain('Input Schema');
  });

  it('input with null param groups', () => {
    const out = render({
      ...base,
      price: { type: 'PER_CALL', amount: { type: 'PER_CALL', amount: '0.01', currency: 'USD' } },
      input: { pathParams: null, queryParams: { q: { type: 'string' } }, body: null },
    });
    expect(out).toContain('Query Params');
  });
});
