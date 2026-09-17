import { describe, expect, it, vi, afterEach } from 'vitest';
import { contrarian } from '../../../src/features/us-strategy-lab/strategies/contrarian.ts';
import { trendFollow } from '../../../src/features/us-strategy-lab/strategies/trendFollow.ts';
import { maCross } from '../../../src/features/us-strategy-lab/strategies/maCross.ts';
import { breakout } from '../../../src/features/us-strategy-lab/strategies/breakout.ts';
import { bollinger } from '../../../src/features/us-strategy-lab/strategies/bollinger.ts';
import { rsiOnly } from '../../../src/features/us-strategy-lab/strategies/rsiOnly.ts';
import { dca } from '../../../src/features/us-strategy-lab/strategies/dca.ts';
import { grid } from '../../../src/features/us-strategy-lab/strategies/grid.ts';
import { momentum } from '../../../src/features/us-strategy-lab/strategies/momentum.ts';
import { volumeSpike } from '../../../src/features/us-strategy-lab/strategies/volumeSpike.ts';
import { macd } from '../../../src/features/us-strategy-lab/strategies/macd.ts';
import { ichimoku } from '../../../src/features/us-strategy-lab/strategies/ichimoku.ts';
import { stochastic } from '../../../src/features/us-strategy-lab/strategies/stochastic.ts';
import { atrBreakout } from '../../../src/features/us-strategy-lab/strategies/atrBreakout.ts';
import { vwapDeviation } from '../../../src/features/us-strategy-lab/strategies/vwapDeviation.ts';
import { dayOfWeek } from '../../../src/features/us-strategy-lab/strategies/dayOfWeek.ts';
import { parabolicReversal } from '../../../src/features/us-strategy-lab/strategies/parabolicReversal.ts';
import { rsiDivergence } from '../../../src/features/us-strategy-lab/strategies/rsiDivergence.ts';
import { relativeStrengthPair } from '../../../src/features/us-strategy-lab/strategies/relativeStrengthPair.ts';
import { keltnerBreakout } from '../../../src/features/us-strategy-lab/strategies/keltnerBreakout.ts';
import { perfectOrder } from '../../../src/features/us-strategy-lab/strategies/perfectOrder.ts';
import { roundNumber } from '../../../src/features/us-strategy-lab/strategies/roundNumber.ts';
import { goldenCross } from '../../../src/features/us-strategy-lab/strategies/goldenCross.ts';
import { longTermBreakout } from '../../../src/features/us-strategy-lab/strategies/longTermBreakout.ts';
import { gapFade } from '../../../src/features/us-strategy-lab/strategies/gapFade.ts';
import { consecutiveDip } from '../../../src/features/us-strategy-lab/strategies/consecutiveDip.ts';
import { lowVolatility } from '../../../src/features/us-strategy-lab/strategies/lowVolatility.ts';
import { biggestMover } from '../../../src/features/us-strategy-lab/strategies/biggestMover.ts';
import { buyAndHold } from '../../../src/features/us-strategy-lab/strategies/buyAndHold.ts';
import { randomWalk } from '../../../src/features/us-strategy-lab/strategies/randomWalk.ts';
import { STRATEGIES } from '../../../src/features/us-strategy-lab/strategies/index.ts';
import type { StrategyPosition, SymbolSnapshot } from '../../../src/features/us-strategy-lab/types.ts';

function snapshot(overrides: Partial<SymbolSnapshot> = {}): SymbolSnapshot {
  return {
    symbol: 'AAPL',
    date: '2026-09-01',
    dayClose: 1_000_000,
    dayOpen: 1_000_000,
    prevClose: 1_000_000,
    dailyMovePct: 0,
    gapPct: 0,
    rsi14: 50,
    rsi14Prior: 50,
    closePrior: 1_000_000,
    volumeRatio: 1,
    consecutiveDownDays: 0,
    sma10: 1_000_000,
    prevSma10: 1_000_000,
    sma25: 1_000_000,
    prevSma25: 1_000_000,
    sma50: 1_000_000,
    prevSma50: 1_000_000,
    sma75: 1_000_000,
    prevSma75: 1_000_000,
    sma200: 1_000_000,
    prevSma200: 1_000_000,
    bollingerMid: 1_000_000,
    bollingerUpper: 1_100_000,
    bollingerLower: 900_000,
    highestHigh20: 1_050_000,
    lowestLow20: 950_000,
    highestHigh200: 1_100_000,
    return20dPct: 0,
    macd: 0,
    macdSignal: 0,
    prevMacd: 0,
    prevMacdSignal: 0,
    tenkanSen: 1_000_000,
    kijunSen: 1_000_000,
    prevTenkanSen: 1_000_000,
    prevKijunSen: 1_000_000,
    stochK: 50,
    stochD: 50,
    atr14: 20_000,
    vwap20: 1_000_000,
    dayOfWeek: 1, // Monday
    ...overrides,
  };
}

function position(lots: StrategyPosition['lots']): StrategyPosition {
  return { lots };
}

describe('contrarian', () => {
  it('buys on a crash confirmed by RSI, volume, and trend', () => {
    const s = snapshot({ dailyMovePct: -4, rsi14: 35, volumeRatio: 1.5, sma75: 900_000 });
    const signal = contrarian.decide(undefined, s, [s]);
    expect(signal.action).toBe('buy');
  });

  it('sells on trend-break while holding', () => {
    const s = snapshot({ dayClose: 900_000, sma75: 1_000_000 }); // >3% below trend
    const signal = contrarian.decide(position([{ quantity: 1, entryPriceUsd: 950_000, entryDate: '2026-08-20' }]), s, [s]);
    expect(signal.action).toBe('sell');
  });
});

describe('trendFollow', () => {
  it('buys when clearly above trend on an up day', () => {
    const s = snapshot({ dayClose: 1_030_000, sma75: 1_000_000, dailyMovePct: 1 });
    expect(trendFollow.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('does not set a limit price (market order — waiting for a dip would contradict the breakout thesis)', () => {
    const s = snapshot({ dayClose: 1_030_000, sma75: 1_000_000, dailyMovePct: 1 });
    expect(trendFollow.decide(undefined, s, [s]).limitPriceUsd).toBeUndefined();
  });

  it('does not buy without a clear trend margin', () => {
    const s = snapshot({ dayClose: 1_005_000, sma75: 1_000_000, dailyMovePct: 1 });
    expect(trendFollow.decide(undefined, s, [s]).action).toBe('skip');
  });

  it('sells once price falls back below the trend line', () => {
    const s = snapshot({ dayClose: 990_000, sma75: 1_000_000 });
    expect(trendFollow.decide(position([{ quantity: 1, entryPriceUsd: 1_030_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('maCross', () => {
  it('buys on a golden cross (25-day crosses above 75-day)', () => {
    const s = snapshot({ prevSma25: 990_000, prevSma75: 1_000_000, sma25: 1_010_000, sma75: 1_000_000 });
    expect(maCross.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('does not buy without a fresh crossover', () => {
    const s = snapshot({ prevSma25: 1_010_000, prevSma75: 1_000_000, sma25: 1_020_000, sma75: 1_000_000 });
    expect(maCross.decide(undefined, s, [s]).action).toBe('skip');
  });

  it('sells on a dead cross while holding', () => {
    const s = snapshot({ prevSma25: 1_010_000, prevSma75: 1_000_000, sma25: 990_000, sma75: 1_000_000 });
    expect(maCross.decide(position([{ quantity: 1, entryPriceUsd: 1_000_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('breakout', () => {
  it('buys on a new 20-day high with volume confirmation', () => {
    const s = snapshot({ dayClose: 1_050_000, highestHigh20: 1_050_000, volumeRatio: 2 });
    expect(breakout.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('does not buy a new high without volume confirmation', () => {
    const s = snapshot({ dayClose: 1_050_000, highestHigh20: 1_050_000, volumeRatio: 1 });
    expect(breakout.decide(undefined, s, [s]).action).toBe('skip');
  });

  it('sells on a new 20-day low', () => {
    const s = snapshot({ dayClose: 950_000, lowestLow20: 950_000 });
    expect(breakout.decide(position([{ quantity: 1, entryPriceUsd: 1_000_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('bollinger', () => {
  it('buys when price touches the lower band', () => {
    const s = snapshot({ dayClose: 900_000, bollingerLower: 900_000 });
    expect(bollinger.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('places its limit at the lower band, not at the day close (real limit-order semantics)', () => {
    const s = snapshot({ dayClose: 895_000, bollingerLower: 900_000 });
    expect(bollinger.decide(undefined, s, [s]).limitPriceUsd).toBe(900_000);
  });

  it('sells once price reverts to the mid band', () => {
    const s = snapshot({ dayClose: 1_000_000, bollingerMid: 1_000_000 });
    expect(bollinger.decide(position([{ quantity: 1, entryPriceUsd: 900_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('rsiOnly', () => {
  it('buys purely on RSI oversold, ignoring price move', () => {
    const s = snapshot({ rsi14: 25, dailyMovePct: 10 });
    expect(rsiOnly.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('sells purely on RSI overbought', () => {
    const s = snapshot({ rsi14: 75 });
    expect(rsiOnly.decide(position([{ quantity: 1, entryPriceUsd: 900_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('dca', () => {
  it('buys when no lots exist yet regardless of price', () => {
    const s = snapshot({ dailyMovePct: -20 });
    expect(dca.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('does not buy again before the interval has elapsed', () => {
    const s = snapshot({ date: '2026-08-25' });
    // quantity chosen so totalSpent (0.0005 * 1,000,000 = $500) stays well under the $1,000 cap —
    // otherwise the "budget already fully spent" check would mask the interval check this test targets.
    const signal = dca.decide(position([{ quantity: 0.0005, entryPriceUsd: 1_000_000, entryDate: '2026-08-20' }]), s, [s]);
    expect(signal.action).toBe('hold');
  });

  it('buys again once the interval has elapsed', () => {
    const s = snapshot({ date: '2026-08-28' });
    const signal = dca.decide(position([{ quantity: 0.0005, entryPriceUsd: 1_000_000, entryDate: '2026-08-20' }]), s, [s]);
    expect(signal.action).toBe('buy');
  });

  it('sells everything once the profit target is hit, regardless of schedule', () => {
    const s = snapshot({ dayClose: 1_600_000, date: '2026-08-21' });
    const signal = dca.decide(position([{ quantity: 0.0005, entryPriceUsd: 1_000_000, entryDate: '2026-08-20' }]), s, [s]);
    expect(signal.action).toBe('sell');
  });
});

describe('grid', () => {
  it('buys at the first grid line below the reference (75-day SMA)', () => {
    const s = snapshot({ dayClose: 970_000, sma75: 1_000_000 });
    expect(grid.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('places its limit exactly at the grid line price, not at the day close', () => {
    const s = snapshot({ dayClose: 970_000, sma75: 1_000_000 }); // grid line = 1,000,000 * (1 - 3%) = 970,000
    expect(grid.decide(undefined, s, [s]).limitPriceUsd).toBeCloseTo(970_000, 6);
  });

  it('does not re-buy a grid level it already holds a lot at', () => {
    const s = snapshot({ dayClose: 970_000, sma75: 1_000_000 });
    const signal = grid.decide(position([{ quantity: 1, entryPriceUsd: 970_000, entryDate: '2026-08-20' }]), s, [s]);
    expect(signal.action).not.toBe('buy');
  });

  it('sells once price rises enough above the average entry', () => {
    const s = snapshot({ dayClose: 1_050_000 });
    const signal = grid.decide(position([{ quantity: 1, entryPriceUsd: 1_000_000, entryDate: '2026-08-20' }]), s, [s]);
    expect(signal.action).toBe('sell');
  });
});

describe('momentum', () => {
  it('buys a symbol currently ranked in the top 5 by 20-day return', () => {
    const strong = snapshot({ symbol: 'AAPL', return20dPct: 50 });
    const weak = Array.from({ length: 5 }, (_, i) => snapshot({ symbol: `WEAK${i}`, return20dPct: -10 * (i + 1) }));
    const all = [strong, ...weak];
    expect(momentum.decide(undefined, strong, all).action).toBe('buy');
    expect(momentum.decide(undefined, weak.at(-1)!, all).action).toBe('skip');
  });

  it('sells once a held symbol drops out of the top 5', () => {
    const held = snapshot({ symbol: 'AAPL', return20dPct: -50 });
    const others = Array.from({ length: 5 }, (_, i) => snapshot({ symbol: `SYM${i}`, return20dPct: (i + 1) * 10 }));
    const all = [held, ...others];
    const signal = momentum.decide(position([{ quantity: 1, entryPriceUsd: 1_000_000, entryDate: '2026-08-20' }]), held, all);
    expect(signal.action).toBe('sell');
  });
});

describe('volumeSpike', () => {
  it('buys on a volume spike with an up move', () => {
    const s = snapshot({ volumeRatio: 4, dailyMovePct: 5 });
    expect(volumeSpike.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('does not buy a volume spike on a down move', () => {
    const s = snapshot({ volumeRatio: 4, dailyMovePct: -5 });
    expect(volumeSpike.decide(undefined, s, [s]).action).toBe('skip');
  });

  it('sells once price falls below the trend line', () => {
    const s = snapshot({ dayClose: 950_000, sma75: 1_000_000 });
    expect(volumeSpike.decide(position([{ quantity: 1, entryPriceUsd: 900_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('macd', () => {
  it('buys on a golden cross (MACD line crosses above signal)', () => {
    const s = snapshot({ prevMacd: -1, prevMacdSignal: 0, macd: 1, macdSignal: 0 });
    expect(macd.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('sells on a dead cross while holding', () => {
    const s = snapshot({ prevMacd: 1, prevMacdSignal: 0, macd: -1, macdSignal: 0 });
    expect(macd.decide(position([{ quantity: 1, entryPriceUsd: 1_000_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('ichimoku', () => {
  it('buys when the tenkan-sen crosses above the kijun-sen', () => {
    const s = snapshot({ prevTenkanSen: 990_000, prevKijunSen: 1_000_000, tenkanSen: 1_010_000, kijunSen: 1_000_000 });
    expect(ichimoku.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('sells when the tenkan-sen crosses below the kijun-sen', () => {
    const s = snapshot({ prevTenkanSen: 1_010_000, prevKijunSen: 1_000_000, tenkanSen: 990_000, kijunSen: 1_000_000 });
    expect(ichimoku.decide(position([{ quantity: 1, entryPriceUsd: 1_000_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('stochastic', () => {
  it('buys when %K crosses above %D in the oversold zone', () => {
    const s = snapshot({ stochK: 15, stochD: 10 });
    expect(stochastic.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('sells when %K crosses below %D in the overbought zone', () => {
    const s = snapshot({ stochK: 82, stochD: 90 });
    expect(stochastic.decide(position([{ quantity: 1, entryPriceUsd: 1_000_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('atrBreakout', () => {
  it('buys when the daily move exceeds 1.5x ATR while above the trend line', () => {
    const s = snapshot({ dayClose: 1_050_000, dailyMovePct: 5, atr14: 20_000, sma75: 1_000_000 });
    expect(atrBreakout.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('sells when price falls 2x ATR below the average entry', () => {
    const s = snapshot({ dayClose: 950_000, atr14: 20_000 });
    expect(atrBreakout.decide(position([{ quantity: 1, entryPriceUsd: 1_000_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('vwapDeviation', () => {
  it('buys when price deviates 5%+ below VWAP', () => {
    const s = snapshot({ dayClose: 940_000, vwap20: 1_000_000 });
    expect(vwapDeviation.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('places its limit at the 5%-below-VWAP target, not at the day close', () => {
    const s = snapshot({ dayClose: 930_000, vwap20: 1_000_000 });
    expect(vwapDeviation.decide(undefined, s, [s]).limitPriceUsd).toBeCloseTo(950_000, 6);
  });

  it('sells once price reverts to VWAP', () => {
    const s = snapshot({ dayClose: 1_010_000, vwap20: 1_000_000 });
    expect(vwapDeviation.decide(position([{ quantity: 1, entryPriceUsd: 940_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('dayOfWeek', () => {
  it('buys on Monday', () => {
    const s = snapshot({ dayOfWeek: 1 });
    expect(dayOfWeek.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('does not buy on other days', () => {
    const s = snapshot({ dayOfWeek: 3 });
    expect(dayOfWeek.decide(undefined, s, [s]).action).toBe('skip');
  });

  it('sells on Friday while holding', () => {
    const s = snapshot({ dayOfWeek: 5 });
    expect(dayOfWeek.decide(position([{ quantity: 1, entryPriceUsd: 1_000_000, entryDate: '2026-08-24' }]), s, [s]).action).toBe('sell');
  });
});

describe('parabolicReversal', () => {
  it('buys on extreme capitulation (25-day deviation <= -15% and RSI < 20)', () => {
    const s = snapshot({ dayClose: 800_000, sma25: 1_000_000, rsi14: 15 });
    expect(parabolicReversal.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('places its limit at the capitulation threshold price, not at the day close', () => {
    const s = snapshot({ dayClose: 800_000, sma25: 1_000_000, rsi14: 15 }); // threshold = 1,000,000 * (1 - 15%) = 850,000
    expect(parabolicReversal.decide(undefined, s, [s]).limitPriceUsd).toBeCloseTo(850_000, 6);
  });

  it('does not buy a merely moderate dip', () => {
    const s = snapshot({ dayClose: 950_000, sma25: 1_000_000, rsi14: 40 });
    expect(parabolicReversal.decide(undefined, s, [s]).action).toBe('skip');
  });

  it('sells once the bounce reaches +10%', () => {
    const s = snapshot({ dayClose: 900_000, rsi14: 50 });
    expect(parabolicReversal.decide(position([{ quantity: 1, entryPriceUsd: 800_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('rsiDivergence', () => {
  it('buys on bullish divergence (price down, RSI up)', () => {
    const s = snapshot({ dayClose: 950_000, closePrior: 1_000_000, rsi14: 50, rsi14Prior: 40 });
    expect(rsiDivergence.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('sells on bearish divergence while holding (price up, RSI down)', () => {
    const s = snapshot({ dayClose: 1_050_000, closePrior: 1_000_000, rsi14: 40, rsi14Prior: 50 });
    expect(rsiDivergence.decide(position([{ quantity: 1, entryPriceUsd: 950_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('relativeStrengthPair', () => {
  it('only acts on GOOGL, skipping every other symbol', () => {
    const goog = snapshot({ symbol: 'GOOG' });
    expect(relativeStrengthPair.decide(undefined, goog, [goog]).action).toBe('skip');
  });

  it('buys GOOGL when it lags GOOG by 1%+ on a trend-relative basis', () => {
    const googl = snapshot({ symbol: 'GOOGL', dayClose: 985_000, sma75: 1_000_000 }); // 98.5%
    const goog = snapshot({ symbol: 'GOOG', dayClose: 1_000_000, sma75: 1_000_000 }); // 100%
    expect(relativeStrengthPair.decide(undefined, googl, [googl, goog]).action).toBe('buy');
  });

  it('sells once GOOGL catches up to GOOG', () => {
    const googl = snapshot({ symbol: 'GOOGL', dayClose: 1_010_000, sma75: 1_000_000 }); // 101%
    const goog = snapshot({ symbol: 'GOOG', dayClose: 1_000_000, sma75: 1_000_000 }); // 100%
    const signal = relativeStrengthPair.decide(position([{ quantity: 1, entryPriceUsd: 985_000, entryDate: '2026-08-20' }]), googl, [googl, goog]);
    expect(signal.action).toBe('sell');
  });
});

describe('keltnerBreakout', () => {
  it('buys when price breaks above the upper channel band', () => {
    const s = snapshot({ dayClose: 1_050_000, sma25: 1_000_000, atr14: 20_000 });
    expect(keltnerBreakout.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('sells once price falls back below the centerline', () => {
    const s = snapshot({ dayClose: 990_000, sma25: 1_000_000 });
    expect(keltnerBreakout.decide(position([{ quantity: 1, entryPriceUsd: 1_050_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('perfectOrder', () => {
  it('buys when a perfect order newly forms (short > mid > long)', () => {
    const s = snapshot({ sma10: 1_100_000, sma25: 1_050_000, sma75: 1_000_000, prevSma10: 1_000_000, prevSma25: 1_050_000, prevSma75: 1_000_000 });
    expect(perfectOrder.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('does not re-buy when the perfect order already existed yesterday', () => {
    const s = snapshot({ sma10: 1_100_000, sma25: 1_050_000, sma75: 1_000_000, prevSma10: 1_090_000, prevSma25: 1_045_000, prevSma75: 1_000_000 });
    expect(perfectOrder.decide(undefined, s, [s]).action).toBe('skip');
  });

  it('sells once the order breaks down', () => {
    const s = snapshot({ sma10: 1_000_000, sma25: 1_050_000, sma75: 1_000_000 });
    expect(perfectOrder.decide(position([{ quantity: 1, entryPriceUsd: 1_000_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('roundNumber', () => {
  it('buys just above a round-number support level', () => {
    const s = snapshot({ dayClose: 1_002_000, sma75: 900_000 });
    expect(roundNumber.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('places its limit at the round-number support level, not at the day close', () => {
    const s = snapshot({ dayClose: 1_002_000, sma75: 900_000 }); // step=100,000, support level=1,000,000
    expect(roundNumber.decide(undefined, s, [s]).limitPriceUsd).toBe(1_000_000);
  });

  it('sells when approaching the next round-number resistance', () => {
    const s = snapshot({ dayClose: 1_099_000 });
    expect(roundNumber.decide(position([{ quantity: 1, entryPriceUsd: 1_002_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('goldenCross', () => {
  it('buys on a golden cross (50-day crosses above 200-day)', () => {
    const s = snapshot({ prevSma50: 990_000, prevSma200: 1_000_000, sma50: 1_010_000, sma200: 1_000_000 });
    expect(goldenCross.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('does not buy without a fresh crossover', () => {
    const s = snapshot({ prevSma50: 1_010_000, prevSma200: 1_000_000, sma50: 1_020_000, sma200: 1_000_000 });
    expect(goldenCross.decide(undefined, s, [s]).action).toBe('skip');
  });

  it('sells on a dead cross while holding', () => {
    const s = snapshot({ prevSma50: 1_010_000, prevSma200: 1_000_000, sma50: 990_000, sma200: 1_000_000 });
    expect(goldenCross.decide(position([{ quantity: 1, entryPriceUsd: 1_000_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('longTermBreakout', () => {
  it('buys on a new ~200-day high with volume confirmation', () => {
    const s = snapshot({ dayClose: 1_100_000, highestHigh200: 1_100_000, volumeRatio: 1.5 });
    expect(longTermBreakout.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('does not buy a new long-term high without volume confirmation', () => {
    const s = snapshot({ dayClose: 1_100_000, highestHigh200: 1_100_000, volumeRatio: 1 });
    expect(longTermBreakout.decide(undefined, s, [s]).action).toBe('skip');
  });

  it('sells on a new 20-day low', () => {
    const s = snapshot({ dayClose: 950_000, lowestLow20: 950_000 });
    expect(longTermBreakout.decide(position([{ quantity: 1, entryPriceUsd: 1_000_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('gapFade', () => {
  it('buys on a 3%+ down-gap at the open', () => {
    const s = snapshot({ gapPct: -4 });
    expect(gapFade.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('does not buy without a meaningful down-gap', () => {
    const s = snapshot({ gapPct: -1 });
    expect(gapFade.decide(undefined, s, [s]).action).toBe('skip');
  });

  it('sells once the gap-fill profit target is reached', () => {
    const s = snapshot({ dayClose: 1_050_000 });
    expect(gapFade.decide(position([{ quantity: 1, entryPriceUsd: 1_000_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });

  it('sells at a loss once the stop-loss is breached', () => {
    const s = snapshot({ dayClose: 930_000 });
    expect(gapFade.decide(position([{ quantity: 1, entryPriceUsd: 1_000_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('consecutiveDip', () => {
  it('buys after 3+ consecutive down days', () => {
    const s = snapshot({ consecutiveDownDays: 3 });
    expect(consecutiveDip.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('places its limit at the day close reached after the down streak', () => {
    const s = snapshot({ consecutiveDownDays: 3, dayClose: 940_000 });
    expect(consecutiveDip.decide(undefined, s, [s]).limitPriceUsd).toBe(940_000);
  });

  it('does not buy on a shorter losing streak', () => {
    const s = snapshot({ consecutiveDownDays: 1 });
    expect(consecutiveDip.decide(undefined, s, [s]).action).toBe('skip');
  });

  it('sells once an up-day reversal confirms with unrealized profit', () => {
    const s = snapshot({ dayClose: 1_010_000, dailyMovePct: 1, consecutiveDownDays: 0 });
    expect(consecutiveDip.decide(position([{ quantity: 1, entryPriceUsd: 1_000_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('lowVolatility', () => {
  it('buys a symbol currently ranked in the top 5 lowest-volatility', () => {
    const calm = snapshot({ symbol: 'AAPL', atr14: 1_000, dayClose: 1_000_000 }); // 0.1% ATR ratio
    const volatile = Array.from({ length: 5 }, (_, i) => snapshot({ symbol: `VOL${i}`, atr14: 50_000 + i * 1_000, dayClose: 1_000_000 }));
    const all = [calm, ...volatile];
    expect(lowVolatility.decide(undefined, calm, all).action).toBe('buy');
    expect(lowVolatility.decide(undefined, volatile.at(-1)!, all).action).toBe('skip');
  });

  it('sells once a held symbol drops out of the low-volatility top 5', () => {
    const held = snapshot({ symbol: 'AAPL', atr14: 90_000, dayClose: 1_000_000 }); // now the most volatile
    const others = Array.from({ length: 5 }, (_, i) => snapshot({ symbol: `SYM${i}`, atr14: 1_000 + i * 100, dayClose: 1_000_000 }));
    const all = [held, ...others];
    const signal = lowVolatility.decide(position([{ quantity: 1, entryPriceUsd: 1_000_000, entryDate: '2026-08-20' }]), held, all);
    expect(signal.action).toBe('sell');
  });
});

describe('biggestMover', () => {
  it('buys the single symbol with the largest absolute daily move', () => {
    const biggest = snapshot({ symbol: 'AAPL', dailyMovePct: -8 });
    const others = [snapshot({ symbol: 'MSFT', dailyMovePct: 2 }), snapshot({ symbol: 'GOOGL', dailyMovePct: -3 })];
    const all = [biggest, ...others];
    expect(biggestMover.decide(undefined, biggest, all).action).toBe('buy');
    expect(biggestMover.decide(undefined, others[0]!, all).action).toBe('skip');
  });

  it('holds on the day it was bought', () => {
    const s = snapshot({ date: '2026-09-01' });
    const signal = biggestMover.decide(position([{ quantity: 1, entryPriceUsd: 1_000_000, entryDate: '2026-09-01' }]), s, [s]);
    expect(signal.action).toBe('hold');
  });

  it('sells unconditionally the day after it was bought', () => {
    const s = snapshot({ date: '2026-09-02' });
    const signal = biggestMover.decide(position([{ quantity: 1, entryPriceUsd: 1_000_000, entryDate: '2026-09-01' }]), s, [s]);
    expect(signal.action).toBe('sell');
  });
});

describe('buyAndHold', () => {
  it('only acts on NVDA, skipping every other symbol', () => {
    const s = snapshot({ symbol: 'AAPL' });
    expect(buyAndHold.decide(undefined, s, [s]).action).toBe('skip');
  });

  it('buys NVDA once when flat', () => {
    const s = snapshot({ symbol: 'NVDA' });
    expect(buyAndHold.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('never sells, regardless of price', () => {
    const s = snapshot({ symbol: 'NVDA', dayClose: 100_000 }); // -90% from entry
    const signal = buyAndHold.decide(position([{ quantity: 1, entryPriceUsd: 1_000_000, entryDate: '2026-08-20' }]), s, [s]);
    expect(signal.action).toBe('hold');
  });
});

describe('randomWalk', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('buys when the coin toss lands below the buy probability while flat', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const s = snapshot();
    expect(randomWalk.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('skips when the coin toss lands above the buy probability while flat', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const s = snapshot();
    expect(randomWalk.decide(undefined, s, [s]).action).toBe('skip');
  });

  it('sells when the coin toss lands below the sell probability while holding', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const s = snapshot();
    const signal = randomWalk.decide(position([{ quantity: 1, entryPriceUsd: 1_000_000, entryDate: '2026-08-20' }]), s, [s]);
    expect(signal.action).toBe('sell');
  });

  it('holds when the coin toss lands above the sell probability while holding', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const s = snapshot();
    const signal = randomWalk.decide(position([{ quantity: 1, entryPriceUsd: 1_000_000, entryDate: '2026-08-20' }]), s, [s]);
    expect(signal.action).toBe('hold');
  });
});

describe('STRATEGIES registry', () => {
  it('contains exactly 30 strategies with unique ids', () => {
    expect(STRATEGIES).toHaveLength(30);
    expect(new Set(STRATEGIES.map((s) => s.id)).size).toBe(30);
  });
});
