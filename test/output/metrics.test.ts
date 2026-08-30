import { describe, it, expect } from 'bun:test';
import chalk from 'chalk';
import {
  formatDuration,
  formatHealth,
  formatHealthCell,
} from '../../src/output/format.js';
import { healthBadge } from '../../src/output/colors.js';
import type { EndpointMetrics } from '../../src/api/types.js';

/** Strip ANSI color codes so assertions are stable regardless of chalk state. */
function plain(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

/** Capture what `formatHealth` writes, as plain (color-free) lines. */
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

describe('formatDuration', () => {
  it('keeps sub-second values in milliseconds', () => {
    // The fastest endpoints in the catalog sit around 700ms — rendering that
    // as "0.7s" would lose precision exactly where it is cheapest to keep.
    expect(formatDuration(699)).toBe('699ms');
    expect(formatDuration(1)).toBe('1ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('switches to seconds at exactly 1000ms', () => {
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(4404)).toBe('4.4s');
    expect(formatDuration(59_999)).toBe('60s');
  });

  it('drops a trailing .0 rather than rendering "4.0s"', () => {
    expect(formatDuration(4000)).toBe('4s');
    expect(formatDuration(120_000)).toBe('2m');
  });

  it('switches to minutes at exactly 60000ms', () => {
    // The slow tail of the catalog reaches ~450s; "447031ms" is unreadable.
    expect(formatDuration(60_000)).toBe('1m');
    expect(formatDuration(185_415)).toBe('3.1m');
    expect(formatDuration(447_031)).toBe('7.5m');
  });

  it('degrades to n/a for nonsense input instead of "NaNms"', () => {
    expect(plain(formatDuration(Number.NaN))).toBe('n/a');
    expect(plain(formatDuration(-1))).toBe('n/a');
    expect(plain(formatDuration(Number.POSITIVE_INFINITY))).toBe('n/a');
  });
});

describe('healthBadge', () => {
  it('prints "unknown" rather than hiding it', () => {
    // Hiding it was tried and reverted: on a backend where `unknown` is the
    // majority verdict the column reads as broken, and a blank cell is
    // indistinguishable from the CLI having dropped the value.
    expect(plain(healthBadge('unknown'))).toBe('unknown');
  });

  it('leaves "unknown" uncolored — it is neither good nor bad news', () => {
    const level = chalk.level;
    chalk.level = 1;
    try {
      expect(healthBadge('unknown')).toBe('unknown');
      expect(healthBadge('unknown')).not.toContain('\u001b[');
    } finally {
      chalk.level = level;
    }
  });

  it('renders nothing only when there is no status at all', () => {
    // A missing block means "no data" — it must never render as healthy.
    expect(healthBadge(undefined)).toBe('');
  });

  it('renders the known adverse and positive verdicts', () => {
    expect(plain(healthBadge('healthy'))).toBe('healthy');
    expect(plain(healthBadge('stable'))).toBe('stable');
    expect(plain(healthBadge('degraded'))).toBe('degraded');
    expect(plain(healthBadge('outage'))).toBe('outage');
  });

  it('colors both good verdicts green — stable is not a caution', () => {
    // `stable` (clean over a long window) is the COMMON good case. Coloring
    // it as a warning would flag most of a working catalog.
    //
    // Color must be FORCED: chalk auto-disables without a TTY, so under the
    // test runner every badge is plain text and a naive comparison would pass
    // no matter which color was applied.
    const level = chalk.level;
    chalk.level = 1;
    try {
      const wrapper = (s: string) => s.replace(/[a-z]+/i, '');
      expect(wrapper(healthBadge('stable'))).toBe(wrapper(healthBadge('healthy')));
      expect(wrapper(healthBadge('stable'))).not.toBe(wrapper(healthBadge('degraded')));
      expect(healthBadge('stable')).toContain('\u001b['); // actually colored
    } finally {
      chalk.level = level;
    }
  });

  it('renders an unrecognized future verdict verbatim instead of dropping it', () => {
    // Forward-compat guard, and NOT theoretical: `stable` was added
    // server-side after this renderer shipped, and reached the CLI through
    // exactly this path. Silently swallowing an unknown verdict is the worst
    // failure mode — the endpoint would look unmeasured rather than flagged.
    expect(plain(healthBadge('maintenance'))).toBe('maintenance');
    expect(plain(healthBadge('quarantined'))).toBe('quarantined');
  });
});

describe('formatHealthCell (discover column)', () => {
  it('renders the verdict and the median run time', () => {
    const m: EndpointMetrics = {
      status: 'healthy',
      runTimeMs: { p50: 4404, p95: 6065 },
    };
    expect(plain(formatHealthCell(m))).toBe('healthy 4.4s');
  });

  it('never shows the tail in the table — only the median', () => {
    // Two durations in a scan column must be read positionally to tell median
    // from tail, and reading them backwards inverts the decision they inform.
    // The labelled two-value render belongs to `inspect`.
    const m: EndpointMetrics = {
      status: 'stable',
      runTimeMs: { p50: 4404, p95: 447_031 },
    };
    expect(plain(formatHealthCell(m))).not.toContain('7.5m');
    expect(plain(formatHealthCell(m))).toBe('stable 4.4s');
  });

  it('renders the verdict alone when there is no run time', () => {
    expect(plain(formatHealthCell({ status: 'degraded' }))).toBe('degraded');
    expect(plain(formatHealthCell({ status: 'outage', runTimeMs: {} }))).toBe('outage');
  });

  it('renders "unknown" next to the run time rather than hiding the verdict', () => {
    const m: EndpointMetrics = { status: 'unknown', runTimeMs: { p50: 16_486 } };
    expect(plain(formatHealthCell(m))).toBe('unknown 16.5s');
  });

  it('shows the verdict alone when only the tail was measured', () => {
    // p95-only is possible on the wire. A bare "6.1s" here would read as the
    // median and understate how fast the endpoint typically is, so the median
    // slot stays empty — but the verdict still prints.
    const m: EndpointMetrics = { status: 'unknown', runTimeMs: { p95: 6065 } };
    expect(plain(formatHealthCell(m))).toBe('unknown');
  });

  it('renders an empty cell only when there is no metrics block at all', () => {
    expect(plain(formatHealthCell(undefined))).toBe('');
    expect(plain(formatHealthCell({ status: 'unknown' }))).toBe('unknown');
  });

  it('renders a zero median rather than treating it as absent', () => {
    // 0 is falsy — a truthiness check would blank a real measurement.
    expect(plain(formatHealthCell({ status: 'healthy', runTimeMs: { p50: 0 } }))).toBe(
      'healthy 0ms',
    );
  });

  it('renders an unrecognized future verdict alongside the run time', () => {
    const m: EndpointMetrics = {
      status: 'maintenance',
      runTimeMs: { p50: 4404 },
    };
    expect(plain(formatHealthCell(m))).toBe('maintenance 4.4s');
  });
});

describe('formatHealth (inspect section)', () => {
  it('prints nothing when metrics are absent', () => {
    expect(capture(() => formatHealth(undefined))).toBe('');
  });

  it('reports an unknown status rather than omitting the line', () => {
    // On a detail view the reader asked about THIS endpoint, so "we don't
    // know" is an answer. A missing line would look like a rendering bug.
    const m: EndpointMetrics = { status: 'unknown' };
    const out = capture(() => formatHealth(m));
    expect(out).toContain('Status:   unknown');
    expect(out).not.toContain('Run time:');
  });

  it('shows both the unknown verdict and the run time', () => {
    // Status and run time are independent, and the majority of prod results
    // are exactly this shape: measured timings, no fresh verdict.
    const m: EndpointMetrics = {
      status: 'unknown',
      runTimeMs: { p50: 16_486, p95: 55_844 },
    };
    const out = capture(() => formatHealth(m));
    expect(out).toContain('Status:   unknown');
    expect(out).toContain('Run time: 16.5s typical · 55.8s tail');
  });

  it('renders both status and run time when present', () => {
    const m: EndpointMetrics = {
      status: 'healthy',
      runTimeMs: { p50: 4404, p95: 6065 },
    };
    const out = capture(() => formatHealth(m));
    expect(out).toContain('Status:   healthy');
    expect(out).toContain('Run time: 4.4s typical · 6.1s tail');
  });

  it('renders a status with no run time', () => {
    const m: EndpointMetrics = { status: 'degraded' };
    const out = capture(() => formatHealth(m));
    expect(out).toContain('Status:   degraded');
    expect(out).not.toContain('Run time:');
  });

  it('renders only p50 when p95 is absent', () => {
    // The percentiles are independently optional on the wire.
    const m: EndpointMetrics = { status: 'healthy', runTimeMs: { p50: 4404 } };
    const out = capture(() => formatHealth(m));
    expect(out).toContain('Run time: 4.4s typical');
    expect(out).not.toContain('tail');
  });

  it('renders only p95 when p50 is absent', () => {
    const m: EndpointMetrics = { status: 'healthy', runTimeMs: { p95: 6065 } };
    const out = capture(() => formatHealth(m));
    expect(out).toContain('Run time: 6.1s tail');
    expect(out).not.toContain('typical');
  });

  it('treats an empty runTimeMs object as no run time', () => {
    // The backend never emits `{}`, but rendering "Run time:" with an empty
    // value would be a visible defect if it ever did.
    const m: EndpointMetrics = { status: 'unknown', runTimeMs: {} };
    const out = capture(() => formatHealth(m));
    expect(out).not.toContain('Run time:');
    expect(out).toContain('Status:   unknown');
  });
});
