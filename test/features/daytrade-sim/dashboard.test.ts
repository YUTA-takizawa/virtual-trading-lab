import { describe, expect, it } from 'vitest';
import { buildDashboardData } from '../../../src/features/daytrade-sim/dashboard.ts';
import type { DaytradeLogEntry, DaytradePosition, DaytradeState } from '../../../src/features/daytrade-sim/types.ts';

function makeState(overrides: Partial<DaytradeState> = {}): DaytradeState {
  return {
    cash: 1_000_000,
    realizedPnlTotal: 0,
    taxPaidTotal: 0,
    commissionPaidTotal: 0,
    positions: {},
    pendingOrders: {},
    lastRunDate: '2026-08-27',
    lastRunSession: 'afternoon',
    lastMorningRunDate: '2026-08-27',
    lastAfternoonRunDate: '2026-08-27',
    log: [],
    equityHistory: [],
    ...overrides,
  };
}

describe('buildDashboardData', () => {
  it('computes summary figures including changePct against the initial capital', () => {
    const state = makeState({ cash: 1_050_000, realizedPnlTotal: 60_000, taxPaidTotal: 10_000, commissionPaidTotal: 2_000 });
    const data = buildDashboardData(state, {}, (s) => s, 1_000_000);

    expect(data.summary.initialCapitalYen).toBe(1_000_000);
    expect(data.summary.totalEquity).toBe(1_050_000);
    expect(data.summary.changePct).toBeCloseTo(5, 8);
    expect(data.summary.realizedPnlGross).toBe(60_000);
    expect(data.summary.realizedPnlNet).toBe(60_000 - 10_000 - 2_000);
  });

  it('resolves symbol names and marks-to-market using currentPrices, falling back to avgEntryPrice', () => {
    const positions: Record<string, DaytradePosition> = {
      '7532.T': { tranches: [{ trancheNumber: 1, shares: 10, entryPrice: 100, entryDate: '2026-08-26' }] },
      '8316.T': { tranches: [{ trancheNumber: 1, shares: 5, entryPrice: 200, entryDate: '2026-08-25' }] },
    };
    const state = makeState({ positions });

    const data = buildDashboardData(state, { '7532.T': 110 }, (s) => (s === '7532.T' ? 'パンパシHD' : s), 1_000_000);

    const p7532 = data.positions.find((p) => p.symbol === '7532.T')!;
    expect(p7532.name).toBe('パンパシHD');
    expect(p7532.currentPrice).toBe(110);
    expect(p7532.marketValue).toBe(1100);
    expect(p7532.unrealizedPnl).toBe(100); // (110-100)*10

    const p8316 = data.positions.find((p) => p.symbol === '8316.T')!;
    expect(p8316.currentPrice).toBeNull(); // no quote given -> falls back to avgEntryPrice for market value
    expect(p8316.marketValue).toBe(1000); // 200 * 5
    expect(p8316.unrealizedPnl).toBeNull();
  });

  it('surfaces the limit price of a pending order, when the queued signal set one (2026-09-01)', () => {
    const state = makeState({
      pendingOrders: {
        '7532.T': { action: 'buy', trancheNumber: 1, limitPrice: 95, reason: 'test', queuedDate: '2026-08-27' },
        '8316.T': { action: 'buy', trancheNumber: 2, reason: 'test', queuedDate: '2026-08-27' },
      },
    });
    const data = buildDashboardData(state, {}, (s) => s, 1_000_000);

    expect(data.pendingOrders.find((p) => p.symbol === '7532.T')!.limitPrice).toBe(95);
    expect(data.pendingOrders.find((p) => p.symbol === '8316.T')!.limitPrice).toBeUndefined();
  });

  it('passes through the full log and equityHistory uncapped (unlike the Discord embeds)', () => {
    const log: DaytradeLogEntry[] = Array.from({ length: 50 }, (_, i) => ({
      date: '2026-08-27',
      symbol: `${1000 + i}.T`,
      action: 'buy',
      price: 100,
      shares: 1,
      reason: `test (ルール${i}: dummy)`,
      trancheNumber: 1,
    }));
    const equityHistory = Array.from({ length: 40 }, (_, i) => ({ date: '2026-08-01', session: 'morning' as const, totalEquity: 1_000_000 + i }));
    const state = makeState({ log, equityHistory });

    const data = buildDashboardData(state, {}, (s) => s, 1_000_000);

    expect(data.trades).toHaveLength(50);
    expect(data.equityHistory).toHaveLength(40);
  });
});
