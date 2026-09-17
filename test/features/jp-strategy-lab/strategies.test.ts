import { describe, expect, it } from 'vitest';
import { swingBracket } from '../../../src/features/jp-strategy-lab/strategies/swingBracket.ts';
import { buyAndHold } from '../../../src/features/jp-strategy-lab/strategies/buyAndHold.ts';
import type { StrategyPosition, SymbolSnapshot } from '../../../src/features/jp-strategy-lab/types.ts';

function snapshot(overrides: Partial<SymbolSnapshot> = {}): SymbolSnapshot {
  return {
    symbol: '7203.T',
    date: '2026-09-04',
    dayClose: 3_000, // 100株で¥300,000、対象レンジ内
    dailyMovePct: 0,
    rsi14: 50,
    volumeRatio: 1,
    sma75: 2_900, // dayClose > sma75 でトレンドフィルタを満たす
    ...overrides,
  };
}

function position(lots: StrategyPosition['lots']): StrategyPosition {
  return { lots };
}

describe('swingBracket — entry', () => {
  it('buys 1 unit (100 shares) on a crash confirmed by RSI, volume, and trend', () => {
    const s = snapshot({ dailyMovePct: -4, rsi14: 35, volumeRatio: 1.5 });
    const signal = swingBracket.decide(undefined, s, [s], 0);
    expect(signal.action).toBe('buy');
    expect(signal.quantity).toBe(100);
  });

  it('places its limit at the crash-confirmed close, not a market order', () => {
    const s = snapshot({ dailyMovePct: -4, rsi14: 35, volumeRatio: 1.5, dayClose: 2_950 });
    const signal = swingBracket.decide(undefined, s, [s], 0);
    expect(signal.limitPriceJpy).toBe(2_950);
  });

  it('does not buy without a confirmed crash', () => {
    const s = snapshot({ dailyMovePct: -1, rsi14: 35, volumeRatio: 1.5 });
    expect(swingBracket.decide(undefined, s, [s], 0).action).toBe('skip');
  });

  it('does not buy when RSI/volume confirmation is missing', () => {
    const s = snapshot({ dailyMovePct: -4, rsi14: 70, volumeRatio: 1.5 });
    expect(swingBracket.decide(undefined, s, [s], 0).action).toBe('skip');
  });

  it('does not buy below the trend line (75-day SMA)', () => {
    const s = snapshot({ dailyMovePct: -4, rsi14: 35, volumeRatio: 1.5, dayClose: 2_800, sma75: 2_900 });
    expect(swingBracket.decide(undefined, s, [s], 0).action).toBe('skip');
  });

  it('does not buy when the 6-slot cap is already reached', () => {
    const s = snapshot({ dailyMovePct: -4, rsi14: 35, volumeRatio: 1.5 });
    const signal = swingBracket.decide(undefined, s, [s], 6);
    expect(signal.action).toBe('skip');
  });

  it('buys with exactly 5 slots already filled (boundary)', () => {
    const s = snapshot({ dailyMovePct: -4, rsi14: 35, volumeRatio: 1.5 });
    expect(swingBracket.decide(undefined, s, [s], 5).action).toBe('buy');
  });

  it('does not buy a stock whose unit cost is below the ¥200,000 floor', () => {
    const s = snapshot({ dailyMovePct: -4, rsi14: 35, volumeRatio: 1.5, dayClose: 1_000, sma75: 900 }); // 100株で¥100,000
    expect(swingBracket.decide(undefined, s, [s], 0).action).toBe('skip');
  });

  it('does not buy a stock whose unit cost is above the ¥500,000 ceiling', () => {
    const s = snapshot({ dailyMovePct: -4, rsi14: 35, volumeRatio: 1.5, dayClose: 6_000, sma75: 5_900 }); // 100株で¥600,000
    expect(swingBracket.decide(undefined, s, [s], 0).action).toBe('skip');
  });

  it('buys at the exact ¥200,000 floor (boundary)', () => {
    const s = snapshot({ dailyMovePct: -4, rsi14: 35, volumeRatio: 1.5, dayClose: 2_000, sma75: 1_900 }); // 100株で¥200,000
    expect(swingBracket.decide(undefined, s, [s], 0).action).toBe('buy');
  });

  it('buys at the exact ¥500,000 ceiling (boundary)', () => {
    const s = snapshot({ dailyMovePct: -4, rsi14: 35, volumeRatio: 1.5, dayClose: 5_000, sma75: 4_900 }); // 100株で¥500,000
    expect(swingBracket.decide(undefined, s, [s], 0).action).toBe('buy');
  });
});

describe('swingBracket — exit (fixed ¥20,000 bracket)', () => {
  it('takes profit once unrealized P&L reaches +¥20,000', () => {
    const s = snapshot({ dayClose: 3_200 }); // (3,200 - 3,000) * 100 = +20,000
    const signal = swingBracket.decide(position([{ quantity: 100, entryPriceJpy: 3_000, entryDate: '2026-09-01' }]), s, [s], 1);
    expect(signal.action).toBe('sell');
  });

  it('stops out once unrealized P&L reaches -¥20,000', () => {
    const s = snapshot({ dayClose: 2_800 }); // (2,800 - 3,000) * 100 = -20,000
    const signal = swingBracket.decide(position([{ quantity: 100, entryPriceJpy: 3_000, entryDate: '2026-09-01' }]), s, [s], 1);
    expect(signal.action).toBe('sell');
  });

  it('holds while unrealized P&L is strictly within the bracket', () => {
    const s = snapshot({ dayClose: 3_100 }); // +10,000, inside the ±20,000 bracket
    const signal = swingBracket.decide(position([{ quantity: 100, entryPriceJpy: 3_000, entryDate: '2026-09-01' }]), s, [s], 1);
    expect(signal.action).toBe('hold');
  });

  it('ignores the 6-slot cap and price-range filter while managing an existing position', () => {
    // Already holding, price has since moved outside the ¥200k-¥500k unit-cost range and slots are "full" —
    // neither should block exit management, only new entries.
    const s = snapshot({ dayClose: 6_500 }); // far outside the entry range, but well within the hold zone relative to entry
    const signal = swingBracket.decide(position([{ quantity: 100, entryPriceJpy: 6_490, entryDate: '2026-09-01' }]), s, [s], 6);
    expect(signal.action).toBe('hold');
  });
});

describe('buyAndHold', () => {
  it('only acts on 7203.T, skipping every other symbol', () => {
    const s = snapshot({ symbol: '9984.T' });
    expect(buyAndHold.decide(undefined, s, [s], 0).action).toBe('skip');
  });

  it('buys as many 100-share units as fit within ~95% of capital when flat', () => {
    const s = snapshot({ symbol: '7203.T', dayClose: 3_000 }); // 95% of ¥3,000,000 = ¥2,850,000 -> 9 units (¥2,700,000)
    const signal = buyAndHold.decide(undefined, s, [s], 0);
    expect(signal.action).toBe('buy');
    expect(signal.quantity).toBe(900);
  });

  it('scales the unit count down as the share price rises', () => {
    const s = snapshot({ symbol: '7203.T', dayClose: 30_000 }); // 95% of ¥3,000,000 = ¥2,850,000 -> 0 full units at ¥3,000,000/unit, floors to the 1-unit minimum
    const signal = buyAndHold.decide(undefined, s, [s], 0);
    expect(signal.action).toBe('buy');
    expect(signal.quantity).toBe(100);
  });

  it('never sells, regardless of price', () => {
    const s = snapshot({ symbol: '7203.T', dayClose: 500 }); // far below entry
    const signal = buyAndHold.decide(position([{ quantity: 100, entryPriceJpy: 3_000, entryDate: '2026-08-20' }]), s, [s], 0);
    expect(signal.action).toBe('hold');
  });
});
