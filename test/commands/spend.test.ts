import { describe, it, expect } from 'bun:test';
import { buildSpendReport } from '../../src/commands/spend.js';
import type { RunListItem } from '../../src/api/types.js';

function run(overrides: Partial<RunListItem>): RunListItem {
  return {
    runId: 'run_1',
    caller: 'USER#u_1',
    provider: 'tikhub',
    providerName: 'TikHub',
    endpoint: '/a',
    status: 'COMPLETED',
    providerResponse: { httpStatus: 200 },
    price: { type: 'PER_CALL', amount: { value: 0.0015, currency: 'USD' } },
    cost: { value: 0.0015, currency: 'USD' },
    createdAt: '2026-08-24T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildSpendReport', () => {
  it('totals spend and groups by provider and endpoint', () => {
    const report = buildSpendReport([
      run({ runId: 'run_1', endpoint: '/a', cost: { value: 0.001, currency: 'USD' } }),
      run({ runId: 'run_2', endpoint: '/b', cost: { value: 0.002, currency: 'USD' } }),
      run({
        runId: 'run_3',
        provider: 'apify',
        providerName: 'Apify',
        endpoint: '/c',
        cost: { value: 0.5, currency: 'USD' },
      }),
    ]);

    expect(report.runs).toBe(3);
    expect(report.spend).toBeCloseTo(0.503);
    expect(report.providers.map((b) => b.provider)).toEqual(['apify', 'tikhub']);
    expect(report.providers[0].spend).toBeCloseTo(0.5);
    expect(report.providers[1].runs).toBe(2);
    expect(report.topEndpoints[0]).toMatchObject({ provider: 'apify', endpoint: '/c' });
  });

  it('ranks top runs by cost', () => {
    const report = buildSpendReport([
      run({ runId: 'run_cheap', cost: { value: 0.001, currency: 'USD' } }),
      run({ runId: 'run_big', cost: { value: 1, currency: 'USD' } }),
      run({ runId: 'run_free', cost: null }),
    ]);

    expect(report.topRuns[0].runId).toBe('run_big');
    expect(report.topRuns).toHaveLength(3);
  });

  it('counts failed runs and their billed spend', () => {
    const report = buildSpendReport([
      run({}),
      run({ runId: 'run_400', providerResponse: { httpStatus: 400 }, cost: null }),
      run({ runId: 'run_timeout', status: 'TIME_OUT', cost: null }),
      run({
        runId: 'run_billed_fail',
        providerResponse: { httpStatus: 500 },
        cost: { value: 0.01, currency: 'USD' },
      }),
    ]);

    expect(report.failedRuns).toBe(3);
    expect(report.failedSpend).toBeCloseTo(0.01);
  });

  it('does not count blocked runs as failures', () => {
    const report = buildSpendReport([
      run({ runId: 'run_blocked', status: 'BLOCKED', providerResponse: undefined, cost: null }),
    ]);

    expect(report.failedRuns).toBe(0);
  });

  it('reads the date range from newest-first items', () => {
    const report = buildSpendReport([
      run({ runId: 'run_new', createdAt: '2026-08-24T00:00:00.000Z' }),
      run({ runId: 'run_old', createdAt: '2026-07-21T00:00:00.000Z' }),
    ]);

    expect(report.firstRunAt).toBe('2026-07-21T00:00:00.000Z');
    expect(report.lastRunAt).toBe('2026-08-24T00:00:00.000Z');
  });

  it('returns an empty report for no runs', () => {
    const report = buildSpendReport([]);

    expect(report.runs).toBe(0);
    expect(report.spend).toBe(0);
    expect(report.providers).toEqual([]);
    expect(report.firstRunAt).toBeUndefined();
  });
});
