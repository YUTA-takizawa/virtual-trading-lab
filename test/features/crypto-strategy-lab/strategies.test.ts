import { describe, expect, it } from 'vitest';
import { contrarian } from '../../../src/features/crypto-strategy-lab/strategies/contrarian.ts';
import { trendFollow } from '../../../src/features/crypto-strategy-lab/strategies/trendFollow.ts';
import { maCross } from '../../../src/features/crypto-strategy-lab/strategies/maCross.ts';
import { breakout } from '../../../src/features/crypto-strategy-lab/strategies/breakout.ts';
import { bollinger } from '../../../src/features/crypto-strategy-lab/strategies/bollinger.ts';
import { rsiOnly } from '../../../src/features/crypto-strategy-lab/strategies/rsiOnly.ts';
import { dca } from '../../../src/features/crypto-strategy-lab/strategies/dca.ts';
import { grid } from '../../../src/features/crypto-strategy-lab/strategies/grid.ts';
import { momentum } from '../../../src/features/crypto-strategy-lab/strategies/momentum.ts';
import { volumeSpike } from '../../../src/features/crypto-strategy-lab/strategies/volumeSpike.ts';
import { macd } from '../../../src/features/crypto-strategy-lab/strategies/macd.ts';
import { ichimoku } from '../../../src/features/crypto-strategy-lab/strategies/ichimoku.ts';
import { stochastic } from '../../../src/features/crypto-strategy-lab/strategies/stochastic.ts';
import { atrBreakout } from '../../../src/features/crypto-strategy-lab/strategies/atrBreakout.ts';
import { vwapDeviation } from '../../../src/features/crypto-strategy-lab/strategies/vwapDeviation.ts';
import { dayOfWeek } from '../../../src/features/crypto-strategy-lab/strategies/dayOfWeek.ts';
import { parabolicReversal } from '../../../src/features/crypto-strategy-lab/strategies/parabolicReversal.ts';
import { rsiDivergence } from '../../../src/features/crypto-strategy-lab/strategies/rsiDivergence.ts';
import { relativeStrengthPair } from '../../../src/features/crypto-strategy-lab/strategies/relativeStrengthPair.ts';
import { keltnerBreakout } from '../../../src/features/crypto-strategy-lab/strategies/keltnerBreakout.ts';
import { perfectOrder } from '../../../src/features/crypto-strategy-lab/strategies/perfectOrder.ts';
import { roundNumber } from '../../../src/features/crypto-strategy-lab/strategies/roundNumber.ts';
import { buyAndHold } from '../../../src/features/crypto-strategy-lab/strategies/buyAndHold.ts';
import type { StrategyPosition, SymbolSnapshot } from '../../../src/features/crypto-strategy-lab/types.ts';

function snapshot(overrides: Partial<SymbolSnapshot> = {}): SymbolSnapshot {
  return {
    symbol: 'BTC-JPY',
    date: '2026-08-31',
    dayClose: 1_000_000,
    dailyMovePct: 0,
    rsi14: 50,
    volumeRatio: 1,
    sma25: 1_000_000,
    sma75: 1_000_000,
    prevSma25: 1_000_000,
    prevSma75: 1_000_000,
    bollingerMid: 1_000_000,
    bollingerUpper: 1_100_000,
    bollingerLower: 900_000,
    highestHigh20: 1_050_000,
    lowestLow20: 950_000,
    return20dPct: 0,
    sma10: 1_000_000,
    prevSma10: 1_000_000,
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
    rsi14Prior: 50,
    closePrior: 1_000_000,
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
    const signal = contrarian.decide(position([{ quantity: 1, entryPriceJpy: 950_000, entryDate: '2026-08-20' }]), s, [s]);
    expect(signal.action).toBe('sell');
  });
});

describe('trendFollow', () => {
  it('buys when clearly above trend on an up day', () => {
    const s = snapshot({ dayClose: 1_030_000, sma75: 1_000_000, dailyMovePct: 1 });
    expect(trendFollow.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('does not buy without a clear trend margin', () => {
    const s = snapshot({ dayClose: 1_005_000, sma75: 1_000_000, dailyMovePct: 1 });
    expect(trendFollow.decide(undefined, s, [s]).action).toBe('skip');
  });

  it('sells once price falls back below the trend line', () => {
    const s = snapshot({ dayClose: 990_000, sma75: 1_000_000 });
    expect(trendFollow.decide(position([{ quantity: 1, entryPriceJpy: 1_030_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('maCross', () => {
  it('buys on a golden cross (25-day crosses above 75-day)', () => {
    const s = snapshot({ prevSma25: 990_000, prevSma75: 1_000_000, sma25: 1_010_000, sma75: 1_000_000 });
    expect(maCross.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('does not buy without a fresh crossover', () => {
    const s = snapshot({ prevSma25: 1_010_000, prevSma75: 1_000_000, sma25: 1_020_000, sma75: 1_000_000 }); // already above yesterday too
    expect(maCross.decide(undefined, s, [s]).action).toBe('skip');
  });

  it('sells on a dead cross while holding', () => {
    const s = snapshot({ prevSma25: 1_010_000, prevSma75: 1_000_000, sma25: 990_000, sma75: 1_000_000 });
    expect(maCross.decide(position([{ quantity: 1, entryPriceJpy: 1_000_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
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
    expect(breakout.decide(position([{ quantity: 1, entryPriceJpy: 1_000_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('bollinger', () => {
  it('buys when price touches the lower band', () => {
    const s = snapshot({ dayClose: 900_000, bollingerLower: 900_000 });
    expect(bollinger.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('sells once price reverts to the mid band', () => {
    const s = snapshot({ dayClose: 1_000_000, bollingerMid: 1_000_000 });
    expect(bollinger.decide(position([{ quantity: 1, entryPriceJpy: 900_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('rsiOnly', () => {
  it('buys purely on RSI oversold, ignoring price move', () => {
    const s = snapshot({ rsi14: 25, dailyMovePct: 10 }); // even a big up-move doesn't block it
    expect(rsiOnly.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('sells purely on RSI overbought', () => {
    const s = snapshot({ rsi14: 75 });
    expect(rsiOnly.decide(position([{ quantity: 1, entryPriceJpy: 900_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('dca', () => {
  it('buys when no lots exist yet regardless of price', () => {
    const s = snapshot({ dailyMovePct: -20 }); // even a crash doesn't change DCA's mechanical schedule
    expect(dca.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('does not buy again before the interval has elapsed', () => {
    const s = snapshot({ date: '2026-08-25' });
    // quantity chosen so totalSpent (0.005 * 1,000,000 = 5,000円) stays well under the 100,000円 cap —
    // otherwise the "budget already fully spent" check would mask the interval check this test targets.
    const signal = dca.decide(position([{ quantity: 0.005, entryPriceJpy: 1_000_000, entryDate: '2026-08-20' }]), s, [s]); // only 5 days since last buy (interval=7)
    expect(signal.action).toBe('hold');
  });

  it('buys again once the interval has elapsed', () => {
    const s = snapshot({ date: '2026-08-28' });
    const signal = dca.decide(position([{ quantity: 0.005, entryPriceJpy: 1_000_000, entryDate: '2026-08-20' }]), s, [s]); // 8 days since last buy
    expect(signal.action).toBe('buy');
  });

  it('sells everything once the profit target is hit, regardless of schedule', () => {
    const s = snapshot({ dayClose: 1_600_000, date: '2026-08-21' }); // +60% vs 1,000,000 entry, only 1 day since last buy
    const signal = dca.decide(position([{ quantity: 0.005, entryPriceJpy: 1_000_000, entryDate: '2026-08-20' }]), s, [s]);
    expect(signal.action).toBe('sell');
  });
});

describe('grid', () => {
  it('buys at the first grid line below the reference (75-day SMA)', () => {
    const s = snapshot({ dayClose: 970_000, sma75: 1_000_000 }); // 3% below reference, 1 grid step
    expect(grid.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('does not re-buy a grid level it already holds a lot at', () => {
    const s = snapshot({ dayClose: 970_000, sma75: 1_000_000 });
    const signal = grid.decide(position([{ quantity: 1, entryPriceJpy: 970_000, entryDate: '2026-08-20' }]), s, [s]);
    expect(signal.action).not.toBe('buy');
  });

  it('sells once price rises enough above the average entry', () => {
    const s = snapshot({ dayClose: 1_050_000 });
    const signal = grid.decide(position([{ quantity: 1, entryPriceJpy: 1_000_000, entryDate: '2026-08-20' }]), s, [s]); // +5% > 4.5% margin
    expect(signal.action).toBe('sell');
  });
});

describe('momentum', () => {
  it('buys a symbol currently ranked in the top 3 by 20-day return', () => {
    const strong = snapshot({ symbol: 'BTC-JPY', return20dPct: 50 });
    const weakA = snapshot({ symbol: 'ETH-JPY', return20dPct: -10 });
    const weakB = snapshot({ symbol: 'XRP-JPY', return20dPct: -20 });
    const weakC = snapshot({ symbol: 'ADA-JPY', return20dPct: -30 });
    const all = [strong, weakA, weakB, weakC];
    expect(momentum.decide(undefined, strong, all).action).toBe('buy');
    expect(momentum.decide(undefined, weakC, all).action).toBe('skip');
  });

  it('sells once a held symbol drops out of the top 3', () => {
    const held = snapshot({ symbol: 'BTC-JPY', return20dPct: -50 }); // now the worst performer
    const others = [1, 2, 3].map((i) => snapshot({ symbol: `SYM${i}-JPY`, return20dPct: i * 10 }));
    const all = [held, ...others];
    const signal = momentum.decide(position([{ quantity: 1, entryPriceJpy: 1_000_000, entryDate: '2026-08-20' }]), held, all);
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
    expect(volumeSpike.decide(position([{ quantity: 1, entryPriceJpy: 900_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('macd', () => {
  it('buys on a golden cross (MACD line crosses above signal)', () => {
    const s = snapshot({ prevMacd: -1, prevMacdSignal: 0, macd: 1, macdSignal: 0 });
    expect(macd.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('sells on a dead cross while holding', () => {
    const s = snapshot({ prevMacd: 1, prevMacdSignal: 0, macd: -1, macdSignal: 0 });
    expect(macd.decide(position([{ quantity: 1, entryPriceJpy: 1_000_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('ichimoku', () => {
  it('buys when the tenkan-sen crosses above the kijun-sen', () => {
    const s = snapshot({ prevTenkanSen: 990_000, prevKijunSen: 1_000_000, tenkanSen: 1_010_000, kijunSen: 1_000_000 });
    expect(ichimoku.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('sells when the tenkan-sen crosses below the kijun-sen', () => {
    const s = snapshot({ prevTenkanSen: 1_010_000, prevKijunSen: 1_000_000, tenkanSen: 990_000, kijunSen: 1_000_000 });
    expect(ichimoku.decide(position([{ quantity: 1, entryPriceJpy: 1_000_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('stochastic', () => {
  it('buys when %K crosses above %D in the oversold zone', () => {
    const s = snapshot({ stochK: 15, stochD: 10 });
    expect(stochastic.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('sells when %K crosses below %D in the overbought zone', () => {
    const s = snapshot({ stochK: 82, stochD: 90 });
    expect(stochastic.decide(position([{ quantity: 1, entryPriceJpy: 1_000_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('atrBreakout', () => {
  it('buys when the daily move exceeds 1.5x ATR while above the trend line', () => {
    const s = snapshot({ dayClose: 1_050_000, dailyMovePct: 5, atr14: 20_000, sma75: 1_000_000 }); // priceMove = 50,000 >= 1.5*20,000
    expect(atrBreakout.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('sells when price falls 2x ATR below the average entry', () => {
    const s = snapshot({ dayClose: 950_000, atr14: 20_000 }); // stop = 1,000,000 - 40,000 = 960,000
    expect(atrBreakout.decide(position([{ quantity: 1, entryPriceJpy: 1_000_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('vwapDeviation', () => {
  it('buys when price deviates 5%+ below VWAP', () => {
    const s = snapshot({ dayClose: 940_000, vwap20: 1_000_000 });
    expect(vwapDeviation.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('sells once price reverts to VWAP', () => {
    const s = snapshot({ dayClose: 1_010_000, vwap20: 1_000_000 });
    expect(vwapDeviation.decide(position([{ quantity: 1, entryPriceJpy: 940_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
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
    expect(dayOfWeek.decide(position([{ quantity: 1, entryPriceJpy: 1_000_000, entryDate: '2026-08-24' }]), s, [s]).action).toBe('sell');
  });
});

describe('parabolicReversal', () => {
  it('buys on extreme capitulation (25-day deviation <= -15% and RSI < 20)', () => {
    const s = snapshot({ dayClose: 800_000, sma25: 1_000_000, rsi14: 15 });
    expect(parabolicReversal.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('does not buy a merely moderate dip', () => {
    const s = snapshot({ dayClose: 950_000, sma25: 1_000_000, rsi14: 40 });
    expect(parabolicReversal.decide(undefined, s, [s]).action).toBe('skip');
  });

  it('sells once the bounce reaches +10%', () => {
    const s = snapshot({ dayClose: 900_000, rsi14: 50 });
    expect(parabolicReversal.decide(position([{ quantity: 1, entryPriceJpy: 800_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('rsiDivergence', () => {
  it('buys on bullish divergence (price down, RSI up)', () => {
    const s = snapshot({ dayClose: 950_000, closePrior: 1_000_000, rsi14: 50, rsi14Prior: 40 });
    expect(rsiDivergence.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('sells on bearish divergence while holding (price up, RSI down)', () => {
    const s = snapshot({ dayClose: 1_050_000, closePrior: 1_000_000, rsi14: 40, rsi14Prior: 50 });
    expect(rsiDivergence.decide(position([{ quantity: 1, entryPriceJpy: 950_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('relativeStrengthPair', () => {
  it('only acts on BTC-JPY, skipping every other symbol', () => {
    const eth = snapshot({ symbol: 'ETH-JPY' });
    expect(relativeStrengthPair.decide(undefined, eth, [eth]).action).toBe('skip');
  });

  it('buys BTC-JPY when it lags ETH-JPY by 5%+ on a trend-relative basis', () => {
    const btc = snapshot({ symbol: 'BTC-JPY', dayClose: 940_000, sma75: 1_000_000 }); // 94%
    const eth = snapshot({ symbol: 'ETH-JPY', dayClose: 1_000_000, sma75: 1_000_000 }); // 100%
    expect(relativeStrengthPair.decide(undefined, btc, [btc, eth]).action).toBe('buy');
  });

  it('sells once BTC-JPY catches up to ETH-JPY', () => {
    const btc = snapshot({ symbol: 'BTC-JPY', dayClose: 1_010_000, sma75: 1_000_000 }); // 101%
    const eth = snapshot({ symbol: 'ETH-JPY', dayClose: 1_000_000, sma75: 1_000_000 }); // 100%
    const signal = relativeStrengthPair.decide(position([{ quantity: 1, entryPriceJpy: 940_000, entryDate: '2026-08-20' }]), btc, [btc, eth]);
    expect(signal.action).toBe('sell');
  });
});

describe('keltnerBreakout', () => {
  it('buys when price breaks above the upper channel band', () => {
    const s = snapshot({ dayClose: 1_050_000, sma25: 1_000_000, atr14: 20_000 }); // upper = 1,040,000
    expect(keltnerBreakout.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('sells once price falls back below the centerline', () => {
    const s = snapshot({ dayClose: 990_000, sma25: 1_000_000 });
    expect(keltnerBreakout.decide(position([{ quantity: 1, entryPriceJpy: 1_050_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
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
    expect(perfectOrder.decide(position([{ quantity: 1, entryPriceJpy: 1_000_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('roundNumber', () => {
  it('buys just above a round-number support level', () => {
    const s = snapshot({ dayClose: 1_002_000, sma75: 900_000 }); // step=100,000, level below=1,000,000, 0.2% above it
    expect(roundNumber.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('sells when approaching the next round-number resistance', () => {
    const s = snapshot({ dayClose: 1_099_000 }); // step=100,000, next level=1,100,000, ~0.09% away
    expect(roundNumber.decide(position([{ quantity: 1, entryPriceJpy: 1_002_000, entryDate: '2026-08-20' }]), s, [s]).action).toBe('sell');
  });
});

describe('buyAndHold', () => {
  it('only acts on BTC-JPY, skipping every other symbol', () => {
    const s = snapshot({ symbol: 'ETH-JPY' });
    expect(buyAndHold.decide(undefined, s, [s]).action).toBe('skip');
  });

  it('buys BTC-JPY once when flat', () => {
    const s = snapshot({ symbol: 'BTC-JPY' });
    expect(buyAndHold.decide(undefined, s, [s]).action).toBe('buy');
  });

  it('never sells, regardless of price', () => {
    const s = snapshot({ symbol: 'BTC-JPY', dayClose: 100_000 }); // -90% from entry
    const signal = buyAndHold.decide(position([{ quantity: 1, entryPriceJpy: 1_000_000, entryDate: '2026-08-20' }]), s, [s]);
    expect(signal.action).toBe('hold');
  });
});
