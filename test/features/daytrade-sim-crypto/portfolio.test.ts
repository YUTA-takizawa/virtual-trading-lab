import { describe, expect, it } from 'vitest';
import {
  applyBuy,
  applySell,
  avgEntryPriceJpy,
  calcTotalEquityJpy,
  calcUnrealizedPnlJpy,
  lastTrancheEntryDate,
  lastTrancheEntryPriceJpy,
  SPREAD_PCT,
  totalQuantity,
} from '../../../src/features/daytrade-sim-crypto/portfolio.ts';
import { createInitialCryptoState } from '../../../src/features/daytrade-sim-crypto/types.ts';
import type { DaytradeCryptoPosition } from '../../../src/features/daytrade-sim-crypto/types.ts';

const QUANTITY_PRECISION = 100_000_000; // mirrors portfolio.ts's private constant

// Mirrors applyBuy's own formula (portfolio.ts) so expected values track the
// implementation instead of hand-typed decimals prone to float-rounding mismatches.
function expectedBuy(trancheBudgetJpy: number, midPriceJpy: number) {
  const effectiveBuyPrice = midPriceJpy * (1 + SPREAD_PCT / 100);
  const quantity = Math.floor((trancheBudgetJpy / effectiveBuyPrice) * QUANTITY_PRECISION) / QUANTITY_PRECISION;
  return { quantity, effectiveBuyPrice, costJpy: quantity * effectiveBuyPrice };
}

describe('applyBuy — yen-fraction (1/9:2/9:6/9) tranche sizing at the modeled buy-side spread price', () => {
  it('spends the tranche-1 share of maxPositionYen (1/9) at mid price + spread', () => {
    const state = createInitialCryptoState(10_000_000);
    const next = applyBuy(state, 'BTC-JPY', 1_000_000, 1, 900_000, 1, '2026-08-29', 'test');

    const { quantity, effectiveBuyPrice, costJpy } = expectedBuy(100_000, 1_000_000);
    expect(next.positions['BTC-JPY']?.tranches).toEqual([{ trancheNumber: 1, quantity, entryPriceJpy: effectiveBuyPrice, entryDate: '2026-08-29' }]);
    expect(next.cashJpy).toBeCloseTo(10_000_000 - costJpy, 6);
    expect(next.spreadCostTotalJpy).toBeCloseTo(quantity * (effectiveBuyPrice - 1_000_000), 6);
  });

  it('stacks tranche 2 (2/9) and tranche 3 (6/9) onto the existing position', () => {
    let state = createInitialCryptoState(10_000_000);
    state = applyBuy(state, 'BTC-JPY', 1_000_000, 1, 900_000, 1, '2026-08-29', 't1');
    state = applyBuy(state, 'BTC-JPY', 1_000_000, 2, 900_000, 1, '2026-08-30', 't2');
    state = applyBuy(state, 'BTC-JPY', 1_000_000, 3, 900_000, 1, '2026-08-31', 't3');

    const position = state.positions['BTC-JPY']!;
    expect(position.tranches.map((t) => t.trancheNumber)).toEqual([1, 2, 3]);
    const expectedTotal = expectedBuy(100_000, 1_000_000).quantity + expectedBuy(200_000, 1_000_000).quantity + expectedBuy(600_000, 1_000_000).quantity;
    expect(totalQuantity(position)).toBeCloseTo(expectedTotal, 6);
  });

  it('does not buy when the budget cannot afford even 1 yen', () => {
    const state = createInitialCryptoState(0.5);
    const next = applyBuy(state, 'BTC-JPY', 1_000_000, 1, 900_000, 1, '2026-08-29', 'test');
    expect(next).toBe(state);
  });

  it('expands buying power with marginMultiplier, allowing cashJpy to go negative', () => {
    const state = createInitialCryptoState(50_000);
    const next = applyBuy(state, 'BTC-JPY', 1_000_000, 1, 900_000, 5, '2026-08-29', 'test');
    expect(next.positions['BTC-JPY']?.tranches[0]?.quantity).toBeGreaterThan(0);
    expect(next.cashJpy).toBeLessThan(0);
  });
});

describe('avgEntryPriceJpy / totalQuantity / lastTranche*', () => {
  it('computes a cost-basis-weighted average across tranches at different prices', () => {
    let state = createInitialCryptoState(10_000_000);
    state = applyBuy(state, 'BTC-JPY', 1_000_000, 1, 900_000, 1, '2026-08-29', 't1');
    state = applyBuy(state, 'BTC-JPY', 2_000_000, 2, 900_000, 1, '2026-08-30', 't2');

    const position = state.positions['BTC-JPY']!;
    const quantity = totalQuantity(position);
    const expectedAvg = (position.tranches[0]!.quantity * position.tranches[0]!.entryPriceJpy + position.tranches[1]!.quantity * position.tranches[1]!.entryPriceJpy) / quantity;
    expect(avgEntryPriceJpy(position)).toBeCloseTo(expectedAvg, 8);
    expect(lastTrancheEntryDate(position)).toBe('2026-08-30');
    expect(lastTrancheEntryPriceJpy(position)).toBe(position.tranches[1]!.entryPriceJpy);
  });
});

describe('applySell', () => {
  it('closes every tranche at once, at the modeled sell-side spread price', () => {
    const position: DaytradeCryptoPosition = { tranches: [{ trancheNumber: 1, quantity: 1, entryPriceJpy: 1_000_000, entryDate: '2026-08-29' }] };
    let state = createInitialCryptoState(1_000_000);
    state = { ...state, positions: { 'BTC-JPY': position } };
    const cashBeforeSell = state.cashJpy;

    state = applySell(state, 'BTC-JPY', 1_200_000, '2026-08-30', 'take profit');

    expect(state.positions['BTC-JPY']).toBeUndefined();
    const effectiveSellPrice = 1_200_000 * (1 - SPREAD_PCT / 100);
    const proceedsJpy = 1 * effectiveSellPrice;
    const realizedPnlJpy = proceedsJpy - 1_000_000;
    expect(state.realizedPnlTotalJpy).toBeCloseTo(realizedPnlJpy, 6);
    expect(state.cashJpy).toBeCloseTo(cashBeforeSell + proceedsJpy, 6);
    expect(state.spreadCostTotalJpy).toBeCloseTo(1 * (1_200_000 - effectiveSellPrice), 6);
  });

  it('is a no-op when there is no position to sell', () => {
    const state = createInitialCryptoState(1_000_000);
    expect(applySell(state, 'BTC-JPY', 1_000_000, '2026-08-29', 'n/a')).toBe(state);
  });
});

describe('calcUnrealizedPnlJpy / calcTotalEquityJpy', () => {
  it('marks open positions to market using the average entry price', () => {
    const position: DaytradeCryptoPosition = { tranches: [{ trancheNumber: 1, quantity: 2, entryPriceJpy: 1_000_000, entryDate: '2026-08-29' }] };
    let state = createInitialCryptoState(1_000_000);
    state = { ...state, positions: { 'BTC-JPY': position } };

    expect(calcUnrealizedPnlJpy(state, { 'BTC-JPY': 1_100_000 })).toBeCloseTo((1_100_000 - 1_000_000) * 2, 6);
    expect(calcTotalEquityJpy(state, { 'BTC-JPY': 1_100_000 })).toBeCloseTo(state.cashJpy + 1_100_000 * 2, 6);
  });

  it('falls back to entry price for equity when a current quote is unavailable', () => {
    const position: DaytradeCryptoPosition = { tranches: [{ trancheNumber: 1, quantity: 2, entryPriceJpy: 1_000_000, entryDate: '2026-08-29' }] };
    let state = createInitialCryptoState(1_000_000);
    state = { ...state, positions: { 'BTC-JPY': position } };

    expect(calcTotalEquityJpy(state, {})).toBeCloseTo(state.cashJpy + 2 * 1_000_000, 6);
    expect(calcUnrealizedPnlJpy(state, {})).toBe(0);
  });
});
