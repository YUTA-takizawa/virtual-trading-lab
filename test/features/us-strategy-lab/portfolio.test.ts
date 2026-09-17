import { describe, expect, it } from 'vitest';
import { applyBuy, applySell, avgEntryPriceUsd, calcTotalEquityUsd, calcUnrealizedPnlUsd, totalQuantity } from '../../../src/features/us-strategy-lab/portfolio.ts';
import { createInitialStrategyState } from '../../../src/features/us-strategy-lab/types.ts';
import type { StrategyPosition } from '../../../src/features/us-strategy-lab/types.ts';
import { calcSecFeeUsd, calcFinraFeeUsd } from '../../../src/features/daytrade-sim-us/portfolio.ts';

const SHARE_PRECISION = 100_000; // mirrors portfolio.ts's private constant

function expectedBuy(budgetUsd: number, priceUsd: number) {
  const quantity = Math.floor((budgetUsd / priceUsd) * SHARE_PRECISION) / SHARE_PRECISION;
  return { quantity, costUsd: quantity * priceUsd };
}

describe('applyBuy — arbitrary budgetUsd per call (no tranche constraint)', () => {
  it('spends up to budgetUsd at the given price, no spread modeled', () => {
    const state = createInitialStrategyState(10_000);
    const next = applyBuy(state, 'AAPL', 200, 1_000, '2026-09-01', 'test');

    const { quantity, costUsd } = expectedBuy(1_000, 200);
    expect(next.positions['AAPL']?.lots).toEqual([{ quantity, entryPriceUsd: 200, entryDate: '2026-09-01' }]);
    expect(next.cashUsd).toBeCloseTo(10_000 - costUsd, 6);
  });

  it('caps spend at available cash when budgetUsd exceeds it', () => {
    const state = createInitialStrategyState(500);
    const next = applyBuy(state, 'AAPL', 200, 1_000, '2026-09-01', 'test');

    const { quantity } = expectedBuy(500, 200);
    expect(next.positions['AAPL']?.lots[0]?.quantity).toBeCloseTo(quantity, 8);
    expect(next.cashUsd).toBeCloseTo(0, 0);
  });

  it('stacks multiple buys into separate lots', () => {
    let state = createInitialStrategyState(10_000);
    state = applyBuy(state, 'AAPL', 200, 500, '2026-09-01', 't1');
    state = applyBuy(state, 'AAPL', 210, 500, '2026-09-02', 't2');

    expect(state.positions['AAPL']?.lots).toHaveLength(2);
  });

  it('does not buy when the budget cannot afford even 1 cent worth', () => {
    const state = createInitialStrategyState(0.005);
    const next = applyBuy(state, 'AAPL', 200, 1_000, '2026-09-01', 'test');
    expect(next).toBe(state);
  });
});

describe('avgEntryPriceUsd / totalQuantity', () => {
  it('computes a cost-basis-weighted average across lots at different prices', () => {
    let state = createInitialStrategyState(10_000);
    state = applyBuy(state, 'AAPL', 200, 500, '2026-09-01', 't1');
    state = applyBuy(state, 'AAPL', 220, 500, '2026-09-02', 't2');

    const position = state.positions['AAPL']!;
    const quantity = totalQuantity(position);
    const expectedAvg = (position.lots[0]!.quantity * position.lots[0]!.entryPriceUsd + position.lots[1]!.quantity * position.lots[1]!.entryPriceUsd) / quantity;
    expect(avgEntryPriceUsd(position)).toBeCloseTo(expectedAvg, 8);
  });
});

describe('applySell', () => {
  it('closes the entire position at once, deducting SEC/FINRA fees from proceeds', () => {
    const position: StrategyPosition = { lots: [{ quantity: 10, entryPriceUsd: 200, entryDate: '2026-09-01' }] };
    let state = createInitialStrategyState(10_000);
    state = { ...state, positions: { AAPL: position } };
    const cashBeforeSell = state.cashUsd;

    state = applySell(state, 'AAPL', 220, '2026-09-02', 'take profit');

    expect(state.positions['AAPL']).toBeUndefined();
    const grossProceedsUsd = 10 * 220;
    const secFeeUsd = calcSecFeeUsd(grossProceedsUsd);
    const finraFeeUsd = calcFinraFeeUsd(10);
    const netProceedsUsd = grossProceedsUsd - secFeeUsd - finraFeeUsd;
    const realizedPnlUsd = netProceedsUsd - 10 * 200;
    expect(state.realizedPnlTotalUsd).toBeCloseTo(realizedPnlUsd, 6);
    expect(state.feesPaidTotalUsd).toBeCloseTo(secFeeUsd + finraFeeUsd, 6);
    expect(state.cashUsd).toBeCloseTo(cashBeforeSell + netProceedsUsd, 6);
  });

  it('is a no-op when there is no position to sell', () => {
    const state = createInitialStrategyState(10_000);
    expect(applySell(state, 'AAPL', 200, '2026-09-01', 'n/a')).toBe(state);
  });
});

describe('calcUnrealizedPnlUsd / calcTotalEquityUsd', () => {
  it('marks open positions to market using the average entry price', () => {
    const position: StrategyPosition = { lots: [{ quantity: 2, entryPriceUsd: 200, entryDate: '2026-09-01' }] };
    let state = createInitialStrategyState(10_000);
    state = { ...state, positions: { AAPL: position } };

    expect(calcUnrealizedPnlUsd(state, { AAPL: 220 })).toBeCloseTo((220 - 200) * 2, 6);
    expect(calcTotalEquityUsd(state, { AAPL: 220 })).toBeCloseTo(state.cashUsd + 220 * 2, 6);
  });

  it('falls back to entry price for equity when a current quote is unavailable', () => {
    const position: StrategyPosition = { lots: [{ quantity: 2, entryPriceUsd: 200, entryDate: '2026-09-01' }] };
    let state = createInitialStrategyState(10_000);
    state = { ...state, positions: { AAPL: position } };

    expect(calcTotalEquityUsd(state, {})).toBeCloseTo(state.cashUsd + 2 * 200, 6);
    expect(calcUnrealizedPnlUsd(state, {})).toBe(0);
  });
});
