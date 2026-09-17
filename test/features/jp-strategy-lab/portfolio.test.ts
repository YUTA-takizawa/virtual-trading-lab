import { describe, expect, it } from 'vitest';
import { applyBuy, applySell, avgEntryPriceJpy, calcTotalEquityJpy, calcUnrealizedPnlJpy, totalQuantity } from '../../../src/features/jp-strategy-lab/portfolio.ts';
import { createInitialStrategyState } from '../../../src/features/jp-strategy-lab/types.ts';
import type { StrategyPosition } from '../../../src/features/jp-strategy-lab/types.ts';

describe('applyBuy — exact share quantity, no spread/commission', () => {
  it('buys exactly the given quantity at the given price', () => {
    const state = createInitialStrategyState(3_000_000);
    const next = applyBuy(state, '7203.T', 3_000, 100, '2026-09-04', 'test');

    expect(next.positions['7203.T']?.lots).toEqual([{ quantity: 100, entryPriceJpy: 3_000, entryDate: '2026-09-04' }]);
    expect(next.cashJpy).toBe(3_000_000 - 3_000 * 100);
  });

  it('is a no-op when cash cannot cover the full cost (no partial fill)', () => {
    const state = createInitialStrategyState(100_000); // less than 100 * 3,000 = 300,000
    const next = applyBuy(state, '7203.T', 3_000, 100, '2026-09-04', 'test');
    expect(next).toBe(state);
  });

  it('is a no-op for a non-positive quantity', () => {
    const state = createInitialStrategyState(3_000_000);
    expect(applyBuy(state, '7203.T', 3_000, 0, '2026-09-04', 'test')).toBe(state);
  });
});

describe('avgEntryPriceJpy / totalQuantity', () => {
  it('computes a cost-basis-weighted average across lots', () => {
    let state = createInitialStrategyState(3_000_000);
    state = applyBuy(state, '7203.T', 3_000, 100, '2026-09-04', 't1');
    state = applyBuy(state, '7203.T', 3_200, 100, '2026-09-05', 't2');

    const position = state.positions['7203.T']!;
    expect(totalQuantity(position)).toBe(200);
    expect(avgEntryPriceJpy(position)).toBeCloseTo(3_100, 8);
  });
});

describe('applySell', () => {
  it('closes the entire position at once', () => {
    const position: StrategyPosition = { lots: [{ quantity: 100, entryPriceJpy: 3_000, entryDate: '2026-09-04' }] };
    let state = createInitialStrategyState(3_000_000);
    state = { ...state, positions: { '7203.T': position } };
    const cashBeforeSell = state.cashJpy;

    state = applySell(state, '7203.T', 3_200, '2026-09-05', 'take profit');

    expect(state.positions['7203.T']).toBeUndefined();
    const proceedsJpy = 100 * 3_200;
    const realizedPnlJpy = proceedsJpy - 100 * 3_000;
    expect(state.realizedPnlTotalJpy).toBe(realizedPnlJpy);
    expect(state.cashJpy).toBe(cashBeforeSell + proceedsJpy);
  });

  it('is a no-op when there is no position to sell', () => {
    const state = createInitialStrategyState(3_000_000);
    expect(applySell(state, '7203.T', 3_000, '2026-09-04', 'n/a')).toBe(state);
  });
});

describe('calcUnrealizedPnlJpy / calcTotalEquityJpy', () => {
  it('marks open positions to market using the average entry price', () => {
    const position: StrategyPosition = { lots: [{ quantity: 100, entryPriceJpy: 3_000, entryDate: '2026-09-04' }] };
    let state = createInitialStrategyState(3_000_000);
    state = { ...state, positions: { '7203.T': position } };

    expect(calcUnrealizedPnlJpy(state, { '7203.T': 3_200 })).toBe((3_200 - 3_000) * 100);
    expect(calcTotalEquityJpy(state, { '7203.T': 3_200 })).toBe(state.cashJpy + 3_200 * 100);
  });

  it('falls back to entry price for equity when a current quote is unavailable', () => {
    const position: StrategyPosition = { lots: [{ quantity: 100, entryPriceJpy: 3_000, entryDate: '2026-09-04' }] };
    let state = createInitialStrategyState(3_000_000);
    state = { ...state, positions: { '7203.T': position } };

    expect(calcTotalEquityJpy(state, {})).toBe(state.cashJpy + 100 * 3_000);
    expect(calcUnrealizedPnlJpy(state, {})).toBe(0);
  });
});
