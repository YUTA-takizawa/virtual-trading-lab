import { describe, expect, it } from 'vitest';
import { applyBuy, applySell, avgEntryPriceJpy, calcTotalEquityJpy, calcUnrealizedPnlJpy, SPREAD_PCT, totalQuantity } from '../../../src/features/crypto-strategy-lab/portfolio.ts';
import { createInitialStrategyState } from '../../../src/features/crypto-strategy-lab/types.ts';
import type { StrategyPosition } from '../../../src/features/crypto-strategy-lab/types.ts';

const QUANTITY_PRECISION = 100_000_000; // mirrors portfolio.ts's private constant

function expectedBuy(budgetJpy: number, midPriceJpy: number) {
  const effectiveBuyPrice = midPriceJpy * (1 + SPREAD_PCT / 100);
  const quantity = Math.floor((budgetJpy / effectiveBuyPrice) * QUANTITY_PRECISION) / QUANTITY_PRECISION;
  return { quantity, effectiveBuyPrice, costJpy: quantity * effectiveBuyPrice };
}

describe('applyBuy — arbitrary budgetJpy per call (no tranche constraint)', () => {
  it('spends up to budgetJpy at mid price + spread', () => {
    const state = createInitialStrategyState(1_000_000);
    const next = applyBuy(state, 'BTC-JPY', 1_000_000, 100_000, '2026-08-31', 'test');

    const { quantity, effectiveBuyPrice, costJpy } = expectedBuy(100_000, 1_000_000);
    expect(next.positions['BTC-JPY']?.lots).toEqual([{ quantity, entryPriceJpy: effectiveBuyPrice, entryDate: '2026-08-31' }]);
    expect(next.cashJpy).toBeCloseTo(1_000_000 - costJpy, 6);
  });

  it('caps spend at available cash when budgetJpy exceeds it', () => {
    const state = createInitialStrategyState(50_000);
    const next = applyBuy(state, 'BTC-JPY', 1_000_000, 100_000, '2026-08-31', 'test');

    const { quantity } = expectedBuy(50_000, 1_000_000);
    expect(next.positions['BTC-JPY']?.lots[0]?.quantity).toBeCloseTo(quantity, 8);
    expect(next.cashJpy).toBeCloseTo(0, 0);
  });

  it('stacks multiple buys into separate lots', () => {
    let state = createInitialStrategyState(1_000_000);
    state = applyBuy(state, 'BTC-JPY', 1_000_000, 50_000, '2026-08-31', 't1');
    state = applyBuy(state, 'BTC-JPY', 1_100_000, 50_000, '2026-09-01', 't2');

    expect(state.positions['BTC-JPY']?.lots).toHaveLength(2);
  });

  it('does not buy when the budget cannot afford even 1 yen worth', () => {
    const state = createInitialStrategyState(0.5);
    const next = applyBuy(state, 'BTC-JPY', 1_000_000, 100_000, '2026-08-31', 'test');
    expect(next).toBe(state);
  });
});

describe('avgEntryPriceJpy / totalQuantity', () => {
  it('computes a cost-basis-weighted average across lots at different prices', () => {
    let state = createInitialStrategyState(1_000_000);
    state = applyBuy(state, 'BTC-JPY', 1_000_000, 50_000, '2026-08-31', 't1');
    state = applyBuy(state, 'BTC-JPY', 2_000_000, 50_000, '2026-09-01', 't2');

    const position = state.positions['BTC-JPY']!;
    const quantity = totalQuantity(position);
    const expectedAvg = (position.lots[0]!.quantity * position.lots[0]!.entryPriceJpy + position.lots[1]!.quantity * position.lots[1]!.entryPriceJpy) / quantity;
    expect(avgEntryPriceJpy(position)).toBeCloseTo(expectedAvg, 8);
  });
});

describe('applySell', () => {
  it('closes the entire position at once, at the modeled sell-side spread price', () => {
    const position: StrategyPosition = { lots: [{ quantity: 1, entryPriceJpy: 1_000_000, entryDate: '2026-08-31' }] };
    let state = createInitialStrategyState(1_000_000);
    state = { ...state, positions: { 'BTC-JPY': position } };
    const cashBeforeSell = state.cashJpy;

    state = applySell(state, 'BTC-JPY', 1_200_000, '2026-09-01', 'take profit');

    expect(state.positions['BTC-JPY']).toBeUndefined();
    const effectiveSellPrice = 1_200_000 * (1 - SPREAD_PCT / 100);
    const proceedsJpy = effectiveSellPrice;
    const realizedPnlJpy = proceedsJpy - 1_000_000;
    expect(state.realizedPnlTotalJpy).toBeCloseTo(realizedPnlJpy, 6);
    expect(state.cashJpy).toBeCloseTo(cashBeforeSell + proceedsJpy, 6);
  });

  it('is a no-op when there is no position to sell', () => {
    const state = createInitialStrategyState(1_000_000);
    expect(applySell(state, 'BTC-JPY', 1_000_000, '2026-08-31', 'n/a')).toBe(state);
  });
});

describe('calcUnrealizedPnlJpy / calcTotalEquityJpy', () => {
  it('marks open positions to market using the average entry price', () => {
    const position: StrategyPosition = { lots: [{ quantity: 2, entryPriceJpy: 1_000_000, entryDate: '2026-08-31' }] };
    let state = createInitialStrategyState(1_000_000);
    state = { ...state, positions: { 'BTC-JPY': position } };

    expect(calcUnrealizedPnlJpy(state, { 'BTC-JPY': 1_100_000 })).toBeCloseTo((1_100_000 - 1_000_000) * 2, 6);
    expect(calcTotalEquityJpy(state, { 'BTC-JPY': 1_100_000 })).toBeCloseTo(state.cashJpy + 1_100_000 * 2, 6);
  });

  it('falls back to entry price for equity when a current quote is unavailable', () => {
    const position: StrategyPosition = { lots: [{ quantity: 2, entryPriceJpy: 1_000_000, entryDate: '2026-08-31' }] };
    let state = createInitialStrategyState(1_000_000);
    state = { ...state, positions: { 'BTC-JPY': position } };

    expect(calcTotalEquityJpy(state, {})).toBeCloseTo(state.cashJpy + 2 * 1_000_000, 6);
    expect(calcUnrealizedPnlJpy(state, {})).toBe(0);
  });
});
