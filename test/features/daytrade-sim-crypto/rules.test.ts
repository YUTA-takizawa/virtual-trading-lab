import { describe, expect, it } from 'vitest';
import { decideTradeCrypto } from '../../../src/features/daytrade-sim-crypto/rules.ts';
import type { DaytradeCryptoThresholds, RuleInputsCrypto } from '../../../src/features/daytrade-sim-crypto/types.ts';

const thresholds: DaytradeCryptoThresholds = {
  crashPct: 3,
  surgePct: 3,
  flatDayPct: 1,
  rsiBuyConfirmMax: 50,
  rsiSellConfirmMin: 55,
  volumeRatioMin: 1.2,
  stopLossPct: 0,
  tranche2ConfirmPct: 1,
};

function inputs(overrides: Partial<RuleInputsCrypto>): RuleInputsCrypto {
  return {
    hasPosition: false,
    tranchesHeld: 0,
    avgEntryPriceJpy: 100,
    lastTrancheEntryPriceJpy: 100,
    canPyramidToday: false,
    dailyMovePct: 0,
    dayClose: 100,
    sma75: 90,
    rsi14: 50,
    volumeRatio: 1,
    ...overrides,
  };
}

describe('decideTradeCrypto — no position held (tranche1)', () => {
  it('buys on a crash confirmed by RSI and volume (rule 1)', () => {
    const signal = decideTradeCrypto(inputs({ dailyMovePct: -4, rsi14: 35, volumeRatio: 1.5 }), thresholds);
    expect(signal.action).toBe('buy');
    expect(signal.trancheNumber).toBe(1);
  });

  it('does not buy a crash without RSI/volume confirmation', () => {
    const signal = decideTradeCrypto(inputs({ dailyMovePct: -4, rsi14: 60, volumeRatio: 1.5 }), thresholds);
    expect(signal.action).toBe('skip');
  });

  it('does not buy a crash on thin volume', () => {
    const signal = decideTradeCrypto(inputs({ dailyMovePct: -4, rsi14: 35, volumeRatio: 0.8 }), thresholds);
    expect(signal.action).toBe('skip');
  });

  it('stays out on a flat, trend-less day (rule 3/4/7)', () => {
    const signal = decideTradeCrypto(inputs({ dailyMovePct: 0.3 }), thresholds);
    expect(signal.action).toBe('skip');
  });

  it('does not chase a surge (rule 1/2: 急騰は買わない・追わない)', () => {
    const signal = decideTradeCrypto(inputs({ dailyMovePct: 5 }), thresholds);
    expect(signal.action).toBe('skip');
  });

  describe('75-day SMA trend filter', () => {
    it('does not buy a crash when the price is already below its 75-day trend', () => {
      const signal = decideTradeCrypto(inputs({ dailyMovePct: -4, rsi14: 35, volumeRatio: 1.5, dayClose: 100, sma75: 105 }), thresholds);
      expect(signal.action).toBe('skip');
    });

    it('buys a crash that dips within an intact uptrend (dayClose still above sma75)', () => {
      const signal = decideTradeCrypto(inputs({ dailyMovePct: -4, rsi14: 35, volumeRatio: 1.5, dayClose: 100, sma75: 95 }), thresholds);
      expect(signal.action).toBe('buy');
    });
  });
});

describe('decideTradeCrypto — holding a position', () => {
  const holding = { hasPosition: true, tranchesHeld: 1 as const };

  it('takes profit on a surge confirmed by overbought RSI (rule 8)', () => {
    const signal = decideTradeCrypto(inputs({ ...holding, dailyMovePct: 4, rsi14: 72 }), thresholds);
    expect(signal.action).toBe('sell');
  });

  it('does not panic-sell on a crash while holding (rule 3)', () => {
    const signal = decideTradeCrypto(inputs({ ...holding, dailyMovePct: -6, rsi14: 20 }), thresholds);
    expect(signal.action).toBe('hold');
  });

  describe('stop-loss (enabled via thresholds.stopLossPct)', () => {
    const withStopLoss: DaytradeCryptoThresholds = { ...thresholds, stopLossPct: 8 };

    it('force-sells once the loss from avg entry price exceeds the stop-loss threshold', () => {
      const signal = decideTradeCrypto(inputs({ ...holding, avgEntryPriceJpy: 100, dayClose: 91 }), withStopLoss);
      expect(signal.action).toBe('sell');
    });

    it('does not trigger while the loss is within the stop-loss threshold', () => {
      const signal = decideTradeCrypto(inputs({ ...holding, avgEntryPriceJpy: 100, dayClose: 93 }), withStopLoss);
      expect(signal.action).toBe('hold');
    });
  });

  describe('trend-break exit (75-day SMA, always on regardless of stopLossPct)', () => {
    it('sells once dayClose falls more than the buffer below the 75-day trend line', () => {
      const signal = decideTradeCrypto(inputs({ ...holding, dayClose: 96, sma75: 100 }), thresholds);
      expect(signal.action).toBe('sell');
    });

    it('does not trigger on a small dip within the hysteresis buffer (avoids whipsaw sell/re-buy)', () => {
      const signal = decideTradeCrypto(inputs({ ...holding, dayClose: 98, sma75: 100 }), thresholds);
      expect(signal.action).toBe('hold');
    });
  });

  describe('1:2:6 pyramiding', () => {
    it('adds tranche 2 once price confirms the move on a later trading day', () => {
      const signal = decideTradeCrypto(inputs({ ...holding, tranchesHeld: 1, canPyramidToday: true, avgEntryPriceJpy: 100, dayClose: 102 }), thresholds);
      expect(signal.action).toBe('buy');
      expect(signal.trancheNumber).toBe(2);
    });

    it('does not add tranche 2 on the same day tranche 1 was opened', () => {
      const signal = decideTradeCrypto(inputs({ ...holding, tranchesHeld: 1, canPyramidToday: false, avgEntryPriceJpy: 100, dayClose: 105 }), thresholds);
      expect(signal.action).toBe('hold');
    });

    it('adds tranche 3 once RSI confirms an uptrend past the tranche-2 entry price', () => {
      const signal = decideTradeCrypto(
        inputs({ ...holding, tranchesHeld: 2, canPyramidToday: true, lastTrancheEntryPriceJpy: 102, dayClose: 105, rsi14: 55 }),
        thresholds,
      );
      expect(signal.action).toBe('buy');
      expect(signal.trancheNumber).toBe(3);
    });

    it('does not add a 4th tranche once all 3 are held', () => {
      const signal = decideTradeCrypto(inputs({ ...holding, tranchesHeld: 3, canPyramidToday: true, avgEntryPriceJpy: 100, dayClose: 150, rsi14: 80 }), thresholds);
      expect(signal.action).toBe('hold');
    });
  });
});
