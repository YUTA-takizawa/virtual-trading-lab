import { describe, expect, it } from 'vitest';
import { buildDashboardDataUs } from '../../../src/features/daytrade-sim-us/dashboard.ts';
import type { DaytradeUsLogEntry, DaytradeUsPosition, DaytradeUsState } from '../../../src/features/daytrade-sim-us/types.ts';

function makeState(overrides: Partial<DaytradeUsState> = {}): DaytradeUsState {
  return {
    cashJpy: 1_000_000,
    realizedPnlTotalJpy: 0,
    taxPaidTotalJpy: 0,
    secFeeTotalUsd: 0,
    finraFeeTotalUsd: 0,
    positions: {},
    pendingOrders: {},
    lastRunDate: '2026-08-27',
    log: [],
    equityHistory: [],
    ...overrides,
  };
}

describe('buildDashboardDataUs', () => {
  it('computes summary figures including changePct against the initial capital', () => {
    const state = makeState({ cashJpy: 1_050_000, realizedPnlTotalJpy: 60_000, taxPaidTotalJpy: 10_000, secFeeTotalUsd: 0.5, finraFeeTotalUsd: 0.2 });
    const data = buildDashboardDataUs(state, {}, 150, (s) => s, 1_000_000);

    expect(data.summary.initialCapitalYen).toBe(1_000_000);
    expect(data.summary.totalEquityJpy).toBe(1_050_000);
    expect(data.summary.changePct).toBeCloseTo(5, 8);
    expect(data.summary.realizedPnlGrossJpy).toBe(60_000);
    expect(data.summary.realizedPnlNetJpy).toBe(60_000 - 10_000);
    expect(data.summary.secFeeTotalUsd).toBe(0.5);
    expect(data.summary.finraFeeTotalUsd).toBe(0.2);
    expect(data.currentFxRate).toBe(150);
  });

  it('resolves symbol names and marks-to-market using currentPricesUsd/currentFxRate, falling back to avgEntryPriceUsd', () => {
    const positions: Record<string, DaytradeUsPosition> = {
      AAPL: { tranches: [{ trancheNumber: 1, shares: 10, entryPriceUsd: 100, entryFxRate: 150, entryDate: '2026-08-26' }] },
      MSFT: { tranches: [{ trancheNumber: 1, shares: 5, entryPriceUsd: 200, entryFxRate: 150, entryDate: '2026-08-25' }] },
    };
    const state = makeState({ positions });

    const data = buildDashboardDataUs(state, { AAPL: 110 }, 150, (s) => (s === 'AAPL' ? 'アップル' : s), 1_000_000);

    const aapl = data.positions.find((p) => p.symbol === 'AAPL')!;
    expect(aapl.name).toBe('アップル');
    expect(aapl.currentPriceUsd).toBe(110);
    expect(aapl.marketValueJpy).toBe(110 * 10 * 150);
    expect(aapl.unrealizedPnlJpy).toBe((110 - 100) * 10 * 150);

    const msft = data.positions.find((p) => p.symbol === 'MSFT')!;
    expect(msft.currentPriceUsd).toBeNull(); // no quote given -> falls back to avgEntryPriceUsd for market value
    expect(msft.marketValueJpy).toBe(200 * 5 * 150); // falls back to current FX rate, not entry FX rate
    expect(msft.unrealizedPnlJpy).toBeNull();
  });

  it('passes through the full log and equityHistory uncapped (unlike the Discord embeds)', () => {
    const log: DaytradeUsLogEntry[] = Array.from({ length: 50 }, (_, i) => ({
      date: '2026-08-27',
      symbol: `SYM${i}`,
      action: 'buy',
      priceUsd: 100,
      fxRate: 150,
      shares: 1,
      reason: `test (ルール${i}: dummy)`,
      trancheNumber: 1,
    }));
    const equityHistory = Array.from({ length: 40 }, (_, i) => ({ date: '2026-08-01', totalEquityJpy: 1_000_000 + i }));
    const state = makeState({ log, equityHistory });

    const data = buildDashboardDataUs(state, {}, 150, (s) => s, 1_000_000);

    expect(data.trades).toHaveLength(50);
    expect(data.equityHistory).toHaveLength(40);
  });
});
