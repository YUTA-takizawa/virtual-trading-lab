import { describe, expect, it } from 'vitest';
import {
  applyBuy,
  applySell,
  avgEntryPriceUsd,
  calcFinraFeeUsd,
  calcSecFeeUsd,
  calcTotalEquityJpy,
  calcUnrealizedPnlJpy,
  FX_SPREAD_YEN,
  lastTrancheEntryDate,
  lastTrancheEntryPriceUsd,
  TAX_RATE_ON_GAINS,
  totalShares,
} from '../../../src/features/daytrade-sim-us/portfolio.ts';
import { createInitialUsState } from '../../../src/features/daytrade-sim-us/types.ts';
import type { DaytradeUsPosition } from '../../../src/features/daytrade-sim-us/types.ts';

// fxRate chosen so fxRate + FX_SPREAD_YEN lands on a clean 150.00 effective rate.
const FX_RATE = 150 - FX_SPREAD_YEN;
const SHARE_PRECISION = 100_000; // mirrors portfolio.ts's private constant — 1 / 0.00001

// Mirrors applyBuy's own formula (portfolio.ts) so expected values track the
// implementation instead of being hand-typed decimals prone to float-rounding mismatches.
function expectedBuy(trancheBudgetJpy: number, priceUsd: number, effectiveBuyRate: number) {
  const spendableUsd = Math.floor(trancheBudgetJpy / effectiveBuyRate);
  const shares = Math.floor((spendableUsd / priceUsd) * SHARE_PRECISION) / SHARE_PRECISION;
  return { shares, costJpy: shares * priceUsd * effectiveBuyRate };
}

describe('applyBuy — yen-fraction (1/9:2/9:6/9) tranche sizing, dollar-denominated fractional-share order', () => {
  it('spends the tranche-1 share of maxPositionYen (1/9) as a $-denominated order, floored to $1 then to 0.00001 shares', () => {
    const state = createInitialUsState(10_000_000);
    const next = applyBuy(state, 'AAPL', 10, FX_RATE, 1, 900_000, 1, '2026-08-13', 'test');

    // budget = 900,000 * 1/9 = 100,000 yen; effective rate = 150 -> floor($666.67) = $666 spendable
    const { shares, costJpy } = expectedBuy(100_000, 10, 150);
    expect(next.positions['AAPL']?.tranches).toEqual([{ trancheNumber: 1, shares, entryPriceUsd: 10, entryFxRate: 150, entryDate: '2026-08-13' }]);
    expect(next.cashJpy).toBeCloseTo(10_000_000 - costJpy, 6);
  });

  it('stacks tranche 2 (2/9) and tranche 3 (6/9) onto the existing position', () => {
    let state = createInitialUsState(10_000_000);
    state = applyBuy(state, 'AAPL', 10, FX_RATE, 1, 900_000, 1, '2026-08-13', 't1');
    state = applyBuy(state, 'AAPL', 10, FX_RATE, 2, 900_000, 1, '2026-08-14', 't2');
    state = applyBuy(state, 'AAPL', 10, FX_RATE, 3, 900_000, 1, '2026-08-17', 't3');

    const position = state.positions['AAPL']!;
    expect(position.tranches.map((t) => t.trancheNumber)).toEqual([1, 2, 3]);
    const expectedTotal = expectedBuy(100_000, 10, 150).shares + expectedBuy(200_000, 10, 150).shares + expectedBuy(600_000, 10, 150).shares;
    expect(totalShares(position)).toBeCloseTo(expectedTotal, 6);
  });

  it('does not buy when the budget cannot afford even $1', () => {
    const state = createInitialUsState(0.5); // less than $1 worth of yen at this rate
    const next = applyBuy(state, 'AAPL', 500, FX_RATE, 1, 900_000, 1, '2026-08-13', 'test');
    expect(next).toBe(state);
  });

  it('expands buying power with marginMultiplier, allowing cashJpy to go negative', () => {
    const state = createInitialUsState(50_000); // 1x can't afford a full tranche-1 budget
    const next = applyBuy(state, 'AAPL', 10, FX_RATE, 1, 900_000, 5, '2026-08-13', 'test');
    expect(next.positions['AAPL']?.tranches[0]?.shares).toBeGreaterThan(0);
    expect(next.cashJpy).toBeLessThan(0);
  });
});

describe('avgEntryPriceUsd / totalShares / lastTranche*', () => {
  it('computes a cost-basis-weighted average (USD) across tranches at different prices/FX rates', () => {
    let state = createInitialUsState(10_000_000);
    state = applyBuy(state, 'AAPL', 10, FX_RATE, 1, 900_000, 1, '2026-08-13', 't1');
    state = applyBuy(state, 'AAPL', 20, FX_RATE, 2, 900_000, 1, '2026-08-14', 't2');

    const position = state.positions['AAPL']!;
    const shares = totalShares(position);
    const expectedAvg = (position.tranches[0]!.shares * 10 + position.tranches[1]!.shares * 20) / shares;
    expect(avgEntryPriceUsd(position)).toBeCloseTo(expectedAvg, 8);
    expect(lastTrancheEntryPriceUsd(position)).toBe(20);
    expect(lastTrancheEntryDate(position)).toBe('2026-08-14');
  });
});

describe('applySell', () => {
  it('closes every tranche, deducts SEC/FINRA fees from USD proceeds, converts at the sell-side FX rate, and withholds tax on the gain', () => {
    const position: DaytradeUsPosition = { tranches: [{ trancheNumber: 1, shares: 100, entryPriceUsd: 10, entryFxRate: 150, entryDate: '2026-08-13' }] };
    let state = createInitialUsState(1_000_000);
    state = { ...state, positions: { AAPL: position } };
    const cashBeforeSell = state.cashJpy;

    const sellPriceUsd = 12;
    const sellFxRate = 150.3; // effective sell rate = 150.3 - 0.15 = 150.15
    state = applySell(state, 'AAPL', sellPriceUsd, sellFxRate, '2026-08-17', 'take profit');

    expect(state.positions['AAPL']).toBeUndefined();

    const effectiveSellRate = sellFxRate - FX_SPREAD_YEN;
    const grossProceedsUsd = 100 * sellPriceUsd;
    const secFeeUsd = calcSecFeeUsd(grossProceedsUsd);
    const finraFeeUsd = calcFinraFeeUsd(100);
    const netProceedsUsd = grossProceedsUsd - secFeeUsd - finraFeeUsd;
    const proceedsJpy = netProceedsUsd * effectiveSellRate;
    const costBasisJpy = 100 * 10 * 150;
    const realizedPnlJpy = proceedsJpy - costBasisJpy;
    const tax = realizedPnlJpy * TAX_RATE_ON_GAINS;

    expect(state.realizedPnlTotalJpy).toBeCloseTo(realizedPnlJpy, 6);
    expect(state.taxPaidTotalJpy).toBeCloseTo(tax, 6);
    expect(state.secFeeTotalUsd).toBeCloseTo(secFeeUsd, 8);
    expect(state.finraFeeTotalUsd).toBeCloseTo(finraFeeUsd, 8);
    expect(state.cashJpy).toBeCloseTo(cashBeforeSell + proceedsJpy - tax, 6);
  });

  it('withholds no tax on a losing trade', () => {
    const position: DaytradeUsPosition = { tranches: [{ trancheNumber: 1, shares: 100, entryPriceUsd: 20, entryFxRate: 150, entryDate: '2026-08-13' }] };
    let state = createInitialUsState(1_000_000);
    state = { ...state, positions: { AAPL: position } };

    state = applySell(state, 'AAPL', 15, FX_RATE, '2026-08-17', 'stop loss'); // clearly a loss

    expect(state.taxPaidTotalJpy).toBe(0);
    expect(state.realizedPnlTotalJpy).toBeLessThan(0);
  });

  it('is a no-op when there is no position to sell', () => {
    const state = createInitialUsState(1_000_000);
    expect(applySell(state, 'AAPL', 10, FX_RATE, '2026-08-13', 'n/a')).toBe(state);
  });
});

describe('calcSecFeeUsd / calcFinraFeeUsd', () => {
  it('applies the SEC fee rate with a 1-cent minimum', () => {
    expect(calcSecFeeUsd(100)).toBe(0.01); // 100 * 0.0000206 = 0.00206, floored up to the 1-cent minimum
    expect(calcSecFeeUsd(1_000_000)).toBeCloseTo(1_000_000 * 0.0000206, 8);
  });

  it('applies the FINRA TAF rate with a 1-cent minimum and $9.79 cap', () => {
    expect(calcFinraFeeUsd(10)).toBe(0.01); // 10 * 0.000195 = 0.00195, floored up to the 1-cent minimum
    expect(calcFinraFeeUsd(100_000)).toBe(9.79); // 100,000 * 0.000195 = 19.5, capped at 9.79
  });
});

describe('calcUnrealizedPnlJpy / calcTotalEquityJpy', () => {
  it('marks open positions to market using the average entry price and current FX rate', () => {
    const position: DaytradeUsPosition = { tranches: [{ trancheNumber: 1, shares: 100, entryPriceUsd: 10, entryFxRate: 150, entryDate: '2026-08-13' }] };
    let state = createInitialUsState(1_000_000);
    state = { ...state, positions: { AAPL: position } };

    expect(calcUnrealizedPnlJpy(state, { AAPL: 12 }, 150)).toBeCloseTo((12 - 10) * 100 * 150, 8);
    expect(calcTotalEquityJpy(state, { AAPL: 12 }, 150)).toBeCloseTo(state.cashJpy + 12 * 100 * 150, 8);
  });

  it('falls back to each tranche entry price/FX rate for equity when a current quote is unavailable', () => {
    const position: DaytradeUsPosition = { tranches: [{ trancheNumber: 1, shares: 100, entryPriceUsd: 10, entryFxRate: 150, entryDate: '2026-08-13' }] };
    let state = createInitialUsState(1_000_000);
    state = { ...state, positions: { AAPL: position } };

    expect(calcTotalEquityJpy(state, {}, 160)).toBeCloseTo(state.cashJpy + 100 * 10 * 150, 8);
    expect(calcUnrealizedPnlJpy(state, {}, 160)).toBe(0);
  });
});
