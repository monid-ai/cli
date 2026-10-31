import { describe, it, expect } from 'bun:test';
import {
  formatDiscoverResults,
  formatInspectResult,
} from '../../src/output/format.js';
import type {
  DiscoverResponse,
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

const price = {
  type: 'PER_CALL',
  amount: { value: 0.0645, currency: 'USD' },
} as unknown as Price;

// Endpoint tags (`verified`, `no-markup`, …) are API data for agents: they
// stay in `--json` output (the raw response), but the human-readable tables
// do not render them.
describe('endpoint tags are not rendered in human output', () => {
  it('discover: no Verified column, no tag text', () => {
    const data: DiscoverResponse = {
      query: 'backlinks',
      count: 1,
      results: [
        {
          provider: 'ahrefs',
          providerName: 'Ahrefs',
          endpoint: '/site-explorer/all-backlinks',
          description: 'Backlinks',
          price,
          score: 0.9,
          tags: ['verified', 'no-markup'],
        },
      ],
    };
    const out = capture(() => formatDiscoverResults(data));
    expect(out).toContain('/site-explorer/all-backlinks');
    expect(out).not.toContain('Verified');
    expect(out).not.toMatch(/markup/i);
  });

  it('inspect: no Verified line, no tag text', () => {
    const data: InspectResponse = {
      id: 'x',
      provider: 'ahrefs',
      providerName: 'Ahrefs',
      endpoint: '/site-explorer/all-backlinks',
      description: 'Backlinks',
      price,
      tags: ['verified', 'no-markup'],
    };
    const out = capture(() => formatInspectResult(data));
    expect(out).toContain('Backlinks');
    expect(out).not.toContain('Verified');
    expect(out).not.toMatch(/markup/i);
  });
});
