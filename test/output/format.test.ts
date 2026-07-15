// TZ is pinned BEFORE any Date formatting so assertions are deterministic
// regardless of the machine running the tests (bun/node honor process.env.TZ
// on POSIX for subsequent Date operations).
process.env.TZ = 'America/Los_Angeles';

import { describe, it, expect } from 'bun:test';
import { formatDate } from '../../src/output/format.js';

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
