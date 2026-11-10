import { describe, it, expect } from 'bun:test';
import { formatTags } from '../../src/output/format.js';
import { cleanTags } from '../../src/commands/discover.js';

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
  // eslint-disable-next-line no-control-regex
  return lines.join('\n').replace(/\u001b\[[0-9;]*m/g, '');
}

describe('monid tags', () => {
  it('prints one row per tag with its meaning, then how to filter', () => {
    const out = capture(() =>
      formatTags({
        tags: [
          { tag: 'free', description: '$0. A free tier.' },
          { tag: 'promotion', description: 'A lower price for a limited time.' },
        ],
      }),
    );
    expect(out).toMatch(/Tag\s+Meaning/);
    expect(out).toMatch(/free\s+\$0\. A free tier\./);
    expect(out).toMatch(/promotion\s+A lower price for a limited time\./);
    expect(out).toContain('--tags <tag,...> / --exclude-tags <tag,...>');
  });

  it('says so when the API lists none', () => {
    expect(capture(() => formatTags({ tags: [] }))).toContain('No tags.');
  });
});

describe('discover --tags parsing', () => {
  it('trims and drops empty entries', () => {
    expect(cleanTags([' free', 'promotion ', ''])).toEqual(['free', 'promotion']);
    expect(cleanTags([''])).toBeUndefined();
    expect(cleanTags(undefined)).toBeUndefined();
  });
});
