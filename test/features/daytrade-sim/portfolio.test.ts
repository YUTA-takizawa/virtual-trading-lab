import { describe, expect, it } from 'vitest';
import {
  applyBuy,
  applyDailyCommission,
  applySell,
  avgEntryPrice,
  calcDailyCommission,
  calcTotalEquity,
  calcUnrealizedPnl,
  exceedsMaxPosition,
  lastTrancheEntryDate,
  lastTrancheEntryPrice,
  TAX_RATE_ON_GAINS,
  totalShares,
} from '../../../src/features/daytrade-sim/portfolio.ts';
import { createInitialState } from '../../../src/features/daytrade-sim/types.ts';

describe('applyBuy — 1:2:6 lot-based tranche sizing (100-share units)', () => {
  it('buys exactly 100 shares (1 lot) for tranche 1', () => {
    const state = createInitialState(1_000_000);
    const next = applyBuy(state, '1234.T', 100, 1, 900_000, 1, '2026-08-13', 'test');
    expect(next.positions['1234.T']?.tranches).toEqual([{ trancheNumber: 1, shares: 100, entryPrice: 100, entryDate: '2026-08-13' }]);
    expect(next.cash).toBe(1_000_000 - 100 * 100);
  });

  it('buys 200 shares (2 lots) for tranche 2 and 600 shares (6 lots) for tranche 3, stacking onto existing tranches', () => {
    let state = createInitialState(1_000_000);
    state = applyBuy(state, '1234.T', 100, 1, 900_000, 1, '2026-08-13', 't1'); // 100 shares @ 100 = 10,000
    state = applyBuy(state, '1234.T', 100, 2, 900_000, 1, '2026-08-14', 't2'); // 200 shares @ 100 = 20,000
    state = applyBuy(state, '1234.T', 100, 3, 900_000, 1, '2026-08-17', 't3'); // 600 shares @ 100 = 60,000

    const position = state.positions['1234.T']!;
    expect(position.tranches.map((t) => t.trancheNumber)).toEqual([1, 2, 3]);
    expect(totalShares(position)).toBe(900); // 100 + 200 + 600
    expect(state.cash).toBe(1_000_000 - 900 * 100); // 90,000 total spent
  });

  it('does not buy a partial lot — skips entirely when the full lot count exceeds available cash', () => {
    const state = createInitialState(5_000); // can't afford 100 shares @ 100 = 10,000
    const next = applyBuy(state, '1234.T', 100, 1, 900_000, 1, '2026-08-13', 'test');
    expect(next).toBe(state);
  });

  it('skips the tranche when the full lot count would exceed maxPositionYen, even with enough cash', () => {
    const state = createInitialState(1_000_000);
    // 100 shares @ 100 = 10,000 cost, but this symbol's cap is only 5,000
    const next = applyBuy(state, '1234.T', 100, 1, 5_000, 1, '2026-08-13', 'test');
    expect(next).toBe(state);
  });

  it('checks maxPositionYen against existing cost basis plus the new tranche, not the new tranche alone', () => {
    let state = createInitialState(1_000_000);
    state = applyBuy(state, '1234.T', 100, 1, 30_000, 1, '2026-08-13', 't1'); // 100 shares @ 100 = 10,000
    // tranche2: 200 shares @ 100 = 20,000 more; 10,000 existing + 20,000 = 30,000, exactly at the cap
    const withTranche2 = applyBuy(state, '1234.T', 100, 2, 30_000, 1, '2026-08-14', 't2');
    expect(totalShares(withTranche2.positions['1234.T']!)).toBe(300);

    let overCap = createInitialState(1_000_000);
    overCap = applyBuy(overCap, '1234.T', 100, 1, 29_999, 1, '2026-08-13', 't1'); // cap 1 yen too low
    const skipped = applyBuy(overCap, '1234.T', 100, 2, 29_999, 1, '2026-08-14', 't2');
    expect(skipped).toBe(overCap);
  });

  it('expands buying power with marginMultiplier, allowing cash to go negative', () => {
    const state = createInitialState(5_000); // 1x can't afford 100 shares @ 100 = 10,000, but 3x margin can
    const next = applyBuy(state, '1234.T', 100, 1, 900_000, 3, '2026-08-13', 'test');
    expect(next.positions['1234.T']?.tranches[0]?.shares).toBe(100);
    expect(next.cash).toBe(5_000 - 10_000); // negative = margin debt
  });

  it('respects marginMultiplier 1 (no leverage) — the same buy that succeeds at 3x fails at 1x', () => {
    const state = createInitialState(5_000);
    const next = applyBuy(state, '1234.T', 100, 1, 900_000, 1, '2026-08-13', 'test');
    expect(next).toBe(state);
  });
});

describe('exceedsMaxPosition — pre-fill check so an unfillable signal is never queued/displayed', () => {
  it('agrees with applyBuy: true exactly when the tranche would blow the cap', () => {
    const state = createInitialState(1_000_000);
    // 100 shares @ 4,000 = 400,000 > 350,000 cap — same threshold applyBuy itself uses
    expect(exceedsMaxPosition(state, '1234.T', 4_000, 1, 350_000)).toBe(true);
    expect(applyBuy(state, '1234.T', 4_000, 1, 350_000, 1, '2026-08-13', 'test')).toBe(state);

    expect(exceedsMaxPosition(state, '1234.T', 3_000, 1, 350_000)).toBe(false);
    expect(applyBuy(state, '1234.T', 3_000, 1, 350_000, 1, '2026-08-13', 'test')).not.toBe(state);
  });

  it('accounts for existing cost basis, not just the new tranche in isolation', () => {
    let state = createInitialState(1_000_000);
    state = applyBuy(state, '1234.T', 100, 1, 30_000, 1, '2026-08-13', 't1'); // 10,000 cost basis
    expect(exceedsMaxPosition(state, '1234.T', 100, 2, 30_000)).toBe(false); // +20,000 = 30,000, exactly at cap
    expect(exceedsMaxPosition(state, '1234.T', 101, 2, 30_000)).toBe(true); // +20,200 > 30,000
  });
});

describe('avgEntryPrice / totalShares / lastTranche*', () => {
  it('computes a cost-basis-weighted average across tranches of different prices', () => {
    let state = createInitialState(10_000_000);
    state = applyBuy(state, '1234.T', 100, 1, 900_000, 1, '2026-08-13', 't1'); // 100 shares @ 100
    state = applyBuy(state, '1234.T', 200, 2, 900_000, 1, '2026-08-14', 't2'); // 200 shares @ 200

    const position = state.positions['1234.T']!;
    expect(totalShares(position)).toBe(300);
    expect(avgEntryPrice(position)).toBeCloseTo((100 * 100 + 200 * 200) / 300, 5);
    expect(lastTrancheEntryPrice(position)).toBe(200);
    expect(lastTrancheEntryDate(position)).toBe('2026-08-14');
  });
});

describe('applySell', () => {
  it('closes every tranche at once, withholds tax on the gain, and credits net proceeds to cash', () => {
    let state = createInitialState(10_000_000);
    state = applyBuy(state, '1234.T', 100, 1, 900_000, 1, '2026-08-13', 't1'); // 100 shares @ 100 = 10,000
    state = applyBuy(state, '1234.T', 200, 2, 900_000, 1, '2026-08-14', 't2'); // 200 shares @ 200 = 40,000
    const cashBeforeSell = state.cash;

    state = applySell(state, '1234.T', 220, '2026-08-17', 'take profit');

    expect(state.positions['1234.T']).toBeUndefined();
    const proceeds = 300 * 220;
    const costBasis = 100 * 100 + 200 * 200;
    const realizedPnl = proceeds - costBasis;
    const tax = realizedPnl * TAX_RATE_ON_GAINS;
    expect(state.realizedPnlTotal).toBe(realizedPnl); // gross, unaffected by tax
    expect(state.taxPaidTotal).toBeCloseTo(tax, 8);
    expect(state.cash).toBeCloseTo(cashBeforeSell + proceeds - tax, 8);
    expect(state.log.at(-1)).toMatchObject({ action: 'sell', shares: 300, realizedPnl, tax });
  });

  it('withholds no tax on a losing trade', () => {
    let state = createInitialState(10_000_000);
    state = applyBuy(state, '1234.T', 200, 1, 900_000, 1, '2026-08-13', 't1'); // 100 shares @ 200 = 20,000
    const cashBeforeSell = state.cash;

    state = applySell(state, '1234.T', 150, '2026-08-17', 'stop loss'); // realizedPnl = 100*150 - 100*200 = -5,000

    expect(state.taxPaidTotal).toBe(0);
    expect(state.cash).toBe(cashBeforeSell + 100 * 150);
    expect(state.log.at(-1)).toMatchObject({ realizedPnl: -5_000, tax: 0 });
  });

  it('is a no-op when there is no position to sell', () => {
    const state = createInitialState(1_000_000);
    expect(applySell(state, '1234.T', 100, '2026-08-13', 'n/a')).toBe(state);
  });
});

describe('calcUnrealizedPnl / calcTotalEquity', () => {
  it('marks open positions to market using the average entry price', () => {
    let state = createInitialState(1_000_000);
    state = applyBuy(state, '1234.T', 100, 1, 900_000, 1, '2026-08-13', 't1'); // 100 shares @ 100

    expect(calcUnrealizedPnl(state, { '1234.T': 105 })).toBe(100 * 5);
    expect(calcTotalEquity(state, { '1234.T': 105 })).toBe(state.cash + 100 * 105);
  });

  it('falls back to entry price for equity when a current price is unavailable', () => {
    let state = createInitialState(1_000_000);
    state = applyBuy(state, '1234.T', 100, 1, 900_000, 1, '2026-08-13', 't1');

    expect(calcTotalEquity(state, {})).toBe(state.cash + 100 * 100);
    expect(calcUnrealizedPnl(state, {})).toBe(0);
  });
});

describe('calcDailyCommission — 立花証券e支店の定額手数料コース', () => {
  it.each([
    [0, 0],
    [120_000, 0],
    [120_001, 176],
    [200_000, 176],
    [200_001, 253],
    [500_000, 253],
    [500_001, 506],
    [1_000_000, 506],
    [1_000_001, 759],
    [2_000_000, 759],
    [2_000_001, 1012],
    [10_000_000, 2783],
  ])('charges %i yen of contract value at %i yen', (contractValue, expectedFee) => {
    expect(calcDailyCommission(contractValue)).toBe(expectedFee);
  });

  it('adds 253 yen per additional 1,000,000 yen once contract value exceeds 10,000,000', () => {
    expect(calcDailyCommission(10_000_001)).toBe(2783 + 253); // rounds up into the next 1M step
    expect(calcDailyCommission(11_000_000)).toBe(2783 + 253);
    expect(calcDailyCommission(12_500_000)).toBe(2783 + 253 * 3);
  });
});

describe('applyDailyCommission', () => {
  it('deducts the fee from cash and accumulates commissionPaidTotal', () => {
    const state = createInitialState(1_000_000);
    const next = applyDailyCommission(state, calcDailyCommission(300_000)); // 253 yen tier

    expect(next.cash).toBe(1_000_000 - 253);
    expect(next.commissionPaidTotal).toBe(253);
  });

  it('is a no-op (same object) when the fee is 0', () => {
    const state = createInitialState(1_000_000);
    expect(applyDailyCommission(state, 0)).toBe(state);
  });
});
