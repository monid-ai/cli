import { describe, it, expect, spyOn } from 'bun:test';
import { formatRunDetail, formatUsd } from '../../src/output/format.js';
import type { RunDetailResponse } from '../../src/api/types.js';

function capture(run: RunDetailResponse): string {
  const spy = spyOn(console, 'log').mockImplementation(() => {});
  try {
    formatRunDetail(run);
    return spy.mock.calls.map((c) => c.join(' ')).join('\n');
  } finally {
    spy.mockRestore();
  }
}

const base = {
  runId: 'run-a',
  caller: 'caller',
  provider: 'apify',
  endpoint: '/x',
  status: 'BLOCKED',
  price: {},
  createdAt: '2026-10-26T00:00:00.000Z',
} as unknown as RunDetailResponse;

// Bodies below mirror what the API's `serializeBlockedControls` emits: every
// amount is a plain USD number, `controlType` is lifted next to `controlId`,
// and `requiredAmount` is the gate's hold/estimate.
describe('runs without a provider answer', () => {
  // GET /v1/runs/:id serializes providerResponse for every terminal run;
  // one that never reached the provider arrives as `{}` (no httpStatus).
  it.each(['RUNNING', 'TIMED_OUT', 'FAILED', 'BLOCKED', 'STOPPED'])(
    'renders a %s run whose providerResponse is {}',
    (status) => {
      const out = capture({ ...base, status, providerResponse: {} } as unknown as RunDetailResponse);
      expect(out).toContain('run-a');
      expect(out).not.toContain('Provider Response');
    },
  );

  it('still shows the provider status when present', () => {
    const out = capture({ ...base, status: 'COMPLETED', providerResponse: { httpStatus: 504 } } as unknown as RunDetailResponse);
    expect(out).toContain('Provider Response');
    expect(out).toContain('504');
  });
});

describe('blocking controls', () => {
  it('renders a run cap block', () => {
    const out = capture({
      ...base,
      controls: [
        {
          controlId: 'rc_01',
          controlType: 'WORKSPACE_RUN_CAP',
          requiredAmount: 0.03,
          snapshot: { type: 'WORKSPACE_RUN_CAP', limitAmount: 0.01 },
        },
      ],
    });
    expect(out).toContain('Workspace Run Cap');
    expect(out).toContain('Limit:     $0.01');
    expect(out).toContain('Required:  $0.03');
  });

  it('renders a budget block', () => {
    const out = capture({
      ...base,
      controls: [
        {
          controlId: 'bud_01',
          controlType: 'WORKSPACE_BUDGET',
          requiredAmount: 0.3,
          snapshot: {
            type: 'WORKSPACE_BUDGET',
            period: 'DAY',
            limitAmount: 0.1,
            availableAmount: 0,
            heldAmount: 0.05,
            spentAmount: 0.05,
            windowStart: '2026-07-11T00:00:00.000Z',
          },
        },
      ],
    });
    expect(out).toContain('Workspace Budget');
    expect(out).toContain('Period:    DAY');
    expect(out).toContain('Limit:     $0.10');
    expect(out).toContain('Available: $0.00');
    expect(out).toContain('Held:      $0.05');
    expect(out).toContain('Spent:     $0.05');
    expect(out).toContain('Required:  $0.30');
  });

  it('renders a wallet balance block', () => {
    const out = capture({
      ...base,
      controls: [
        {
          controlId: 'WALLET_BALANCE',
          controlType: 'WORKSPACE_WALLET_BALANCE',
          requiredAmount: 0.3,
          snapshot: {
            type: 'WORKSPACE_WALLET_BALANCE',
            limitAmount: 0.1,
            availableAmount: 0.1,
            heldAmount: 0,
            syncedAt: '2026-07-11T00:00:00.000Z',
          },
        },
      ],
    });
    expect(out).toContain('Wallet Balance');
    expect(out).toContain('Balance:   $0.10');
    expect(out).toContain('Available: $0.10');
    expect(out).toContain('Required:  $0.30');
    expect(out).not.toContain('"type"'); // not the raw JSON fallback
  });

  it('shows wallet amounts in millionths of a dollar', () => {
    const out = capture({
      ...base,
      controls: [
        {
          controlId: 'WALLET_BALANCE',
          controlType: 'WORKSPACE_WALLET_BALANCE',
          requiredAmount: 0.5,
          snapshot: {
            type: 'WORKSPACE_WALLET_BALANCE',
            limitAmount: 0.239685,
            availableAmount: 0.219685,
            heldAmount: 0.02,
            syncedAt: '2026-07-11T00:00:00.000Z',
          },
        },
      ],
    });
    expect(out).toContain('Balance:   $0.239685');
    expect(out).toContain('Held:      $0.02');
    expect(out).toContain('Available: $0.219685');
    expect(out).toContain('Required:  $0.50');
  });

  it('formatUsd: up to six decimals, always cents, never negative', () => {
    expect(formatUsd(0.219685)).toBe('$0.219685');
    expect(formatUsd(0.5)).toBe('$0.50');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.016)).toBe('$0.016');
    expect(formatUsd(12)).toBe('$12.00');
    expect(formatUsd(-0.2)).toBe('$0.00');
    expect(formatUsd(0.0000004)).toBe('$0.00');
    expect(formatUsd('x')).toBe('-');
  });

  it('never crashes on a missing or malformed amount', () => {
    const out = capture({
      ...base,
      controls: [
        {
          controlId: 'rc_02',
          snapshot: { type: 'WORKSPACE_RUN_CAP' } as unknown as { type: 'WORKSPACE_RUN_CAP'; limitAmount: number },
        },
        {
          controlId: 'rc_03',
          snapshot: {
            type: 'WORKSPACE_RUN_CAP',
            limitAmount: { value: 0.3, currency: 'USD' },
          } as unknown as { type: 'WORKSPACE_RUN_CAP'; limitAmount: number },
        },
      ],
    });
    expect(out).toContain('rc_02');
    expect(out).toContain('rc_03');
    expect(out).toContain('Limit:     -');
    expect(out).not.toContain('Required:');
  });
});
