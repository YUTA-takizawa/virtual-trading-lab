import { describe, expect, it } from 'vitest';
import { buildDashboardDataCrypto } from '../../../src/features/daytrade-sim-crypto/dashboard.ts';
import type { DaytradeCryptoLogEntry, DaytradeCryptoPosition, DaytradeCryptoState } from '../../../src/features/daytrade-sim-crypto/types.ts';

function makeState(overrides: Partial<DaytradeCryptoState> = {}): DaytradeCryptoState {
  return {
    cashJpy: 1_000_000,
    realizedPnlTotalJpy: 0,
    spreadCostTotalJpy: 0,
    positions: {},
    lastNotifiedAt: '2026-08-29T12:00:00.000Z',
    lastNotifiedLogCount: 0,
    log: [],
    equityHistory: [],
    dashboardEquityHistory: [],
    lastDashboardPublishedAt: '2026-08-29T12:00:00.000Z',
    ...overrides,
  };
}

describe('buildDashboardDataCrypto', () => {
  it('computes summary figures including changePct against the initial capital', () => {
    const state = makeState({ cashJpy: 1_050_000, realizedPnlTotalJpy: 60_000, spreadCostTotalJpy: 2_000 });
    const data = buildDashboardDataCrypto(state, {}, (s) => s, 1_000_000);

    expect(data.summary.initialCapitalYen).toBe(1_000_000);
    expect(data.summary.totalEquityJpy).toBe(1_050_000);
    expect(data.summary.changePct).toBeCloseTo(5, 8);
    expect(data.summary.realizedPnlJpy).toBe(60_000);
    expect(data.summary.spreadCostTotalJpy).toBe(2_000);
  });

  it('resolves symbol names and marks-to-market using currentPricesJpy, falling back to avgEntryPriceJpy', () => {
    const positions: Record<string, DaytradeCryptoPosition> = {
      'BTC-JPY': { tranches: [{ trancheNumber: 1, quantity: 0.1, entryPriceJpy: 1_000_000, entryDate: '2026-08-28' }] },
      'ETH-JPY': { tranches: [{ trancheNumber: 1, quantity: 1, entryPriceJpy: 400_000, entryDate: '2026-08-27' }] },
    };
    const state = makeState({ positions });

    const data = buildDashboardDataCrypto(state, { 'BTC-JPY': 1_100_000 }, (s) => (s === 'BTC-JPY' ? 'ビットコイン' : s), 1_000_000);

    const btc = data.positions.find((p) => p.symbol === 'BTC-JPY')!;
    expect(btc.name).toBe('ビットコイン');
    expect(btc.currentPriceJpy).toBe(1_100_000);
    expect(btc.marketValueJpy).toBe(0.1 * 1_100_000);
    expect(btc.unrealizedPnlJpy).toBeCloseTo((1_100_000 - 1_000_000) * 0.1, 8);

    const eth = data.positions.find((p) => p.symbol === 'ETH-JPY')!;
    expect(eth.currentPriceJpy).toBeNull();
    expect(eth.marketValueJpy).toBe(400_000);
    expect(eth.unrealizedPnlJpy).toBeNull();
  });

  it('passes through the full log and equityHistory uncapped (unlike the Discord embeds)', () => {
    const log: DaytradeCryptoLogEntry[] = Array.from({ length: 50 }, (_, i) => ({
      date: '2026-08-29',
      symbol: `COIN${i}-JPY`,
      action: 'buy',
      priceJpy: 100,
      quantity: 1,
      reason: `test (ルール${i}: dummy)`,
      trancheNumber: 1,
    }));
    const dashboardEquityHistory = Array.from({ length: 40 }, (_, i) => ({ date: '2026-08-01', session: 'morning' as const, totalEquityJpy: 1_000_000 + i }));
    const state = makeState({ log, dashboardEquityHistory });

    const data = buildDashboardDataCrypto(state, {}, (s) => s, 1_000_000);

    expect(data.trades).toHaveLength(50);
    expect(data.equityHistory).toHaveLength(40);
  });
});
