import { describe, expect, it } from 'vitest';
import { decideTradeUs } from '../../../src/features/daytrade-sim-us/rules.ts';
import type { DaytradeUsThresholds, RuleInputsUs } from '../../../src/features/daytrade-sim-us/types.ts';

const thresholds: DaytradeUsThresholds = {
  crashPct: 3,
  surgePct: 3,
  flatDayPct: 1,
  rsiBuyConfirmMax: 50,
  rsiSellConfirmMin: 55,
  volumeRatioMin: 1.2,
  stopLossPct: 0,
  tranche2ConfirmPct: 1,
};

function inputs(overrides: Partial<RuleInputsUs>): RuleInputsUs {
  return {
    hasPosition: false,
    tranchesHeld: 0,
    avgEntryPriceUsd: 100,
    lastTrancheEntryPriceUsd: 100,
    canPyramidToday: false,
    dailyMovePct: 0,
    dayClose: 100,
    sma75: 90, // default: price above trend, so most tests aren't affected by the trend filter/break
    rsi14: 50,
    volumeRatio: 1,
    ...overrides,
  };
}

describe('decideTradeUs — no position held (tranche1)', () => {
  it('buys on a crash confirmed by RSI and volume (rule 1)', () => {
    const signal = decideTradeUs(inputs({ dailyMovePct: -4, rsi14: 35, volumeRatio: 1.5 }), thresholds);
    expect(signal.action).toBe('buy');
    expect(signal.trancheNumber).toBe(1);
  });

  it('does not buy a crash without RSI/volume confirmation', () => {
    const signal = decideTradeUs(inputs({ dailyMovePct: -4, rsi14: 60, volumeRatio: 1.5 }), thresholds);
    expect(signal.action).toBe('skip');
  });

  it('does not buy a crash on thin volume', () => {
    const signal = decideTradeUs(inputs({ dailyMovePct: -4, rsi14: 35, volumeRatio: 0.8 }), thresholds);
    expect(signal.action).toBe('skip');
  });

  it('stays out on a flat, trend-less day (rule 3/4/7)', () => {
    const signal = decideTradeUs(inputs({ dailyMovePct: 0.3 }), thresholds);
    expect(signal.action).toBe('skip');
  });

  it('does not chase a surge (rule 1/2: 急騰は買わない・追わない)', () => {
    const signal = decideTradeUs(inputs({ dailyMovePct: 5 }), thresholds);
    expect(signal.action).toBe('skip');
  });

  it('honors a loosened thresholds.rsiBuyConfirmMax instead of a hardcoded value', () => {
    const looser: DaytradeUsThresholds = { ...thresholds, rsiBuyConfirmMax: 60 };
    const signal = decideTradeUs(inputs({ dailyMovePct: -4, rsi14: 57, volumeRatio: 1.5 }), looser);
    expect(signal.action).toBe('buy');
  });

  describe('75-day SMA trend filter', () => {
    it('does not buy a crash when the stock is already below its 75-day trend', () => {
      const signal = decideTradeUs(inputs({ dailyMovePct: -4, rsi14: 35, volumeRatio: 1.5, dayClose: 100, sma75: 105 }), thresholds);
      expect(signal.action).toBe('skip');
    });

    it('buys a crash that dips within an intact uptrend (dayClose still above sma75)', () => {
      const signal = decideTradeUs(inputs({ dailyMovePct: -4, rsi14: 35, volumeRatio: 1.5, dayClose: 100, sma75: 95 }), thresholds);
      expect(signal.action).toBe('buy');
    });
  });
});

describe('decideTradeUs — holding a position', () => {
  const holding = { hasPosition: true, tranchesHeld: 1 as const };

  it('takes profit on a surge confirmed by overbought RSI (rule 8)', () => {
    const signal = decideTradeUs(inputs({ ...holding, dailyMovePct: 4, rsi14: 72 }), thresholds);
    expect(signal.action).toBe('sell');
  });

  it('does not sell on a surge if RSI is not confirming overbought', () => {
    const signal = decideTradeUs(inputs({ ...holding, dailyMovePct: 4, rsi14: 50 }), thresholds);
    expect(signal.action).toBe('hold');
  });

  it('does not panic-sell on a crash while holding (rule 3)', () => {
    const signal = decideTradeUs(inputs({ ...holding, dailyMovePct: -6, rsi14: 20 }), thresholds);
    expect(signal.action).toBe('hold');
  });

  it('holds with no forced stop-loss when disabled (stopLossPct: 0) and nothing else triggers', () => {
    const signal = decideTradeUs(inputs({ ...holding, dailyMovePct: -1.5, dayClose: 80, avgEntryPriceUsd: 100, sma75: 70 }), thresholds);
    expect(signal.action).toBe('hold');
  });

  describe('stop-loss (enabled via thresholds.stopLossPct)', () => {
    const withStopLoss: DaytradeUsThresholds = { ...thresholds, stopLossPct: 8 };

    it('force-sells once the loss from avg entry price exceeds the stop-loss threshold', () => {
      const signal = decideTradeUs(inputs({ ...holding, avgEntryPriceUsd: 100, dayClose: 91 }), withStopLoss);
      expect(signal.action).toBe('sell');
    });

    it('does not trigger while the loss is within the stop-loss threshold', () => {
      const signal = decideTradeUs(inputs({ ...holding, avgEntryPriceUsd: 100, dayClose: 93 }), withStopLoss);
      expect(signal.action).toBe('hold');
    });

    it('takes priority over rule 3 (no panic-sell on a crash)', () => {
      const signal = decideTradeUs(inputs({ ...holding, avgEntryPriceUsd: 100, dayClose: 90, dailyMovePct: -6 }), withStopLoss);
      expect(signal.action).toBe('sell');
    });
  });

  describe('trend-break exit (75-day SMA, always on regardless of stopLossPct)', () => {
    it('sells once dayClose falls more than the buffer below the 75-day trend line', () => {
      const signal = decideTradeUs(inputs({ ...holding, dayClose: 96, sma75: 100 }), thresholds);
      expect(signal.action).toBe('sell');
    });

    it('does not trigger while dayClose is still above the trend line', () => {
      const signal = decideTradeUs(inputs({ ...holding, dayClose: 101, sma75: 100 }), thresholds);
      expect(signal.action).toBe('hold');
    });

    it('does not trigger on a small dip within the hysteresis buffer (avoids whipsaw sell/re-buy)', () => {
      const signal = decideTradeUs(inputs({ ...holding, dayClose: 98, sma75: 100 }), thresholds);
      expect(signal.action).toBe('hold');
    });

    it('takes priority over rule 3 (no panic-sell on a crash)', () => {
      const signal = decideTradeUs(inputs({ ...holding, dayClose: 96, sma75: 100, dailyMovePct: -6 }), thresholds);
      expect(signal.action).toBe('sell');
    });
  });

  describe('1:2:6 pyramiding', () => {
    it('adds tranche 2 once price confirms the move on a later trading day', () => {
      const signal = decideTradeUs(inputs({ ...holding, tranchesHeld: 1, canPyramidToday: true, avgEntryPriceUsd: 100, dayClose: 102 }), thresholds);
      expect(signal.action).toBe('buy');
      expect(signal.trancheNumber).toBe(2);
    });

    it('does not add tranche 2 on the same day tranche 1 was opened', () => {
      const signal = decideTradeUs(inputs({ ...holding, tranchesHeld: 1, canPyramidToday: false, avgEntryPriceUsd: 100, dayClose: 105 }), thresholds);
      expect(signal.action).toBe('hold');
    });

    it('does not add tranche 2 without enough favorable movement', () => {
      const signal = decideTradeUs(inputs({ ...holding, tranchesHeld: 1, canPyramidToday: true, avgEntryPriceUsd: 100, dayClose: 100.5 }), thresholds);
      expect(signal.action).toBe('hold');
    });

    it('adds tranche 3 once RSI confirms an uptrend past the tranche-2 entry price', () => {
      const signal = decideTradeUs(
        inputs({ ...holding, tranchesHeld: 2, canPyramidToday: true, lastTrancheEntryPriceUsd: 102, dayClose: 105, rsi14: 55 }),
        thresholds,
      );
      expect(signal.action).toBe('buy');
      expect(signal.trancheNumber).toBe(3);
    });

    it('does not add tranche 3 when RSI has not turned upward', () => {
      const signal = decideTradeUs(
        inputs({ ...holding, tranchesHeld: 2, canPyramidToday: true, lastTrancheEntryPriceUsd: 102, dayClose: 105, rsi14: 45 }),
        thresholds,
      );
      expect(signal.action).toBe('hold');
    });

    it('does not add a 4th tranche once all 3 are held', () => {
      const signal = decideTradeUs(inputs({ ...holding, tranchesHeld: 3, canPyramidToday: true, avgEntryPriceUsd: 100, dayClose: 150, rsi14: 80 }), thresholds);
      expect(signal.action).toBe('hold');
    });
  });
});
