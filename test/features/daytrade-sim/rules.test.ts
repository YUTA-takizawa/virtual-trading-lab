import { describe, expect, it } from 'vitest';
import { decideTrade } from '../../../src/features/daytrade-sim/rules.ts';
import type { DaytradeThresholds, RuleInputs } from '../../../src/features/daytrade-sim/types.ts';

const thresholds: DaytradeThresholds = {
  morningCrashPct: 3,
  morningSurgePct: 3,
  afternoonSurgePct: 3,
  flatDayPct: 1,
  rsiBuyConfirmMax: 50,
  rsiSellConfirmMin: 55,
  volumeRatioMin: 1.2,
  perMax: 15,
  pbrMax: 1,
  stopLossPct: 0,
  tranche2ConfirmPct: 1,
};

function inputs(overrides: Partial<RuleInputs>): RuleInputs {
  return {
    hasPosition: false,
    tranchesHeld: 0,
    avgEntryPrice: 100,
    lastTrancheEntryPrice: 100,
    canPyramidToday: false,
    morningMovePct: 0,
    afternoonMovePct: 0,
    fullDayMovePct: 0,
    dayClose: 100,
    sma75: 90, // default: price above trend, so existing tests aren't affected by the new trend filter/break
    rsi14: 50,
    volumeRatio: 1,
    per: undefined,
    pbr: undefined,
    earningsAnnouncedToday: false,
    ...overrides,
  };
}

describe('decideTrade — no position held (tranche1)', () => {
  it('buys on a morning crash confirmed by RSI and volume (rule 1)', () => {
    const signal = decideTrade(inputs({ morningMovePct: -4, rsi14: 35, volumeRatio: 1.5 }), thresholds);
    expect(signal.action).toBe('buy');
    expect(signal.trancheNumber).toBe(1);
  });

  it('sets a limit price at the crash-confirmed close, not a market order (2026-09-01)', () => {
    const signal = decideTrade(inputs({ morningMovePct: -4, rsi14: 35, volumeRatio: 1.5, dayClose: 970 }), thresholds);
    expect(signal.limitPrice).toBe(970);
  });

  it('does not buy a morning crash without RSI/volume confirmation', () => {
    const signal = decideTrade(inputs({ morningMovePct: -4, rsi14: 60, volumeRatio: 1.5 }), thresholds);
    expect(signal.action).toBe('skip');
  });

  it('does not buy a morning crash on thin volume', () => {
    const signal = decideTrade(inputs({ morningMovePct: -4, rsi14: 35, volumeRatio: 0.8 }), thresholds);
    expect(signal.action).toBe('skip');
  });

  it('stays out on a flat, trend-less day (rule 3/4/7)', () => {
    const signal = decideTrade(inputs({ fullDayMovePct: 0.3 }), thresholds);
    expect(signal.action).toBe('skip');
  });

  it('does not chase a morning surge (rule 1: 急騰は買わない)', () => {
    const signal = decideTrade(inputs({ morningMovePct: 5, fullDayMovePct: 5 }), thresholds);
    expect(signal.action).toBe('skip');
  });

  it('does not chase an afternoon surge (rule 2: 追わない)', () => {
    const signal = decideTrade(inputs({ afternoonMovePct: 5, fullDayMovePct: 5 }), thresholds);
    expect(signal.action).toBe('skip');
  });

  it('does not buy a morning crash when PER exceeds the fundamentals filter', () => {
    const signal = decideTrade(inputs({ morningMovePct: -4, rsi14: 35, volumeRatio: 1.5, per: 20, pbr: 0.5 }), thresholds);
    expect(signal.action).toBe('skip');
  });

  it('does not buy a morning crash when PBR exceeds the fundamentals filter', () => {
    const signal = decideTrade(inputs({ morningMovePct: -4, rsi14: 35, volumeRatio: 1.5, per: 10, pbr: 1.5 }), thresholds);
    expect(signal.action).toBe('skip');
  });

  it('buys when PER/PBR are within the fundamentals filter', () => {
    const signal = decideTrade(inputs({ morningMovePct: -4, rsi14: 35, volumeRatio: 1.5, per: 10, pbr: 0.8 }), thresholds);
    expect(signal.action).toBe('buy');
  });

  it('fails open (still buys) when PER/PBR data is unavailable', () => {
    const signal = decideTrade(inputs({ morningMovePct: -4, rsi14: 35, volumeRatio: 1.5, per: undefined, pbr: undefined }), thresholds);
    expect(signal.action).toBe('buy');
  });

  it('bypasses the RSI confirmation on an earnings-day crash (場中決算プレイ簡易版)', () => {
    const signal = decideTrade(inputs({ morningMovePct: -4, rsi14: 65, volumeRatio: 1.5, earningsAnnouncedToday: true }), thresholds);
    expect(signal.action).toBe('buy');
  });

  it('still requires volume confirmation even on an earnings-day crash', () => {
    const signal = decideTrade(inputs({ morningMovePct: -4, rsi14: 65, volumeRatio: 0.5, earningsAnnouncedToday: true }), thresholds);
    expect(signal.action).toBe('skip');
  });

  it('honors a loosened thresholds.rsiBuyConfirmMax instead of a hardcoded value', () => {
    const looser: DaytradeThresholds = { ...thresholds, rsiBuyConfirmMax: 60 };
    const signal = decideTrade(inputs({ morningMovePct: -4, rsi14: 57, volumeRatio: 1.5 }), looser);
    expect(signal.action).toBe('buy');
  });

  describe('75-day SMA trend filter', () => {
    it('does not buy a morning crash when the stock is already below its 75-day trend', () => {
      const signal = decideTrade(inputs({ morningMovePct: -4, rsi14: 35, volumeRatio: 1.5, dayClose: 100, sma75: 105 }), thresholds);
      expect(signal.action).toBe('skip');
    });

    it('buys a morning crash that dips within an intact uptrend (dayClose still above sma75)', () => {
      const signal = decideTrade(inputs({ morningMovePct: -4, rsi14: 35, volumeRatio: 1.5, dayClose: 100, sma75: 95 }), thresholds);
      expect(signal.action).toBe('buy');
    });
  });
});

describe('decideTrade — holding a position', () => {
  const holding = { hasPosition: true, tranchesHeld: 1 as const };

  it('takes profit on an afternoon surge confirmed by overbought RSI (rule 8)', () => {
    const signal = decideTrade(inputs({ ...holding, afternoonMovePct: 4, rsi14: 72 }), thresholds);
    expect(signal.action).toBe('sell');
  });

  it('does not sell on an afternoon surge if RSI is not confirming overbought', () => {
    const signal = decideTrade(inputs({ ...holding, afternoonMovePct: 4, rsi14: 50 }), thresholds);
    expect(signal.action).toBe('hold');
  });

  it('takes profit on a morning surge regardless of RSI (rule 1: 朝の急騰は売り)', () => {
    const signal = decideTrade(inputs({ ...holding, morningMovePct: 4, rsi14: 40 }), thresholds);
    expect(signal.action).toBe('sell');
  });

  it('does not panic-sell on a morning crash while holding (rule 3)', () => {
    const signal = decideTrade(inputs({ ...holding, morningMovePct: -6, rsi14: 20 }), thresholds);
    expect(signal.action).toBe('hold');
  });

  it('holds with no forced stop-loss when disabled (stopLossPct: 0) and nothing else triggers', () => {
    // sma75 overridden below dayClose so this test isolates stopLossPct-off
    // behavior from the separate, always-on trend-break exit (see below).
    const signal = decideTrade(inputs({ ...holding, fullDayMovePct: -1.5, dayClose: 80, avgEntryPrice: 100, sma75: 70 }), thresholds);
    expect(signal.action).toBe('hold');
  });

  describe('stop-loss (enabled via thresholds.stopLossPct)', () => {
    const withStopLoss: DaytradeThresholds = { ...thresholds, stopLossPct: 8 };

    it('force-sells once the loss from avg entry price exceeds the stop-loss threshold', () => {
      const signal = decideTrade(inputs({ ...holding, avgEntryPrice: 100, dayClose: 91 }), withStopLoss);
      expect(signal.action).toBe('sell');
    });

    it('does not trigger while the loss is within the stop-loss threshold', () => {
      const signal = decideTrade(inputs({ ...holding, avgEntryPrice: 100, dayClose: 93 }), withStopLoss);
      expect(signal.action).toBe('hold');
    });

    it('takes priority over rule 3 (no panic-sell on a morning crash)', () => {
      const signal = decideTrade(inputs({ ...holding, avgEntryPrice: 100, dayClose: 90, morningMovePct: -6 }), withStopLoss);
      expect(signal.action).toBe('sell');
    });
  });

  describe('trend-break exit (75-day SMA, always on regardless of stopLossPct)', () => {
    it('sells once dayClose falls more than the buffer below the 75-day trend line', () => {
      // sma75=100, buffer=3% -> break line is 97; 96 is clearly past it
      const signal = decideTrade(inputs({ ...holding, dayClose: 96, sma75: 100 }), thresholds); // stopLossPct: 0 (default off)
      expect(signal.action).toBe('sell');
    });

    it('does not trigger while dayClose is still above the trend line', () => {
      const signal = decideTrade(inputs({ ...holding, dayClose: 101, sma75: 100 }), thresholds);
      expect(signal.action).toBe('hold');
    });

    it('does not trigger on a small dip within the hysteresis buffer (avoids whipsaw sell/re-buy)', () => {
      // 98 is only 2% below sma75=100 — inside the 3% buffer, so this should hold, not sell
      const signal = decideTrade(inputs({ ...holding, dayClose: 98, sma75: 100 }), thresholds);
      expect(signal.action).toBe('hold');
    });

    it('takes priority over rule 3 (no panic-sell on a morning crash)', () => {
      const signal = decideTrade(inputs({ ...holding, dayClose: 96, sma75: 100, morningMovePct: -6 }), thresholds);
      expect(signal.action).toBe('sell');
    });
  });

  describe('1:2:6 pyramiding', () => {
    it('adds tranche 2 once price confirms the move on a later trading day', () => {
      const signal = decideTrade(inputs({ ...holding, tranchesHeld: 1, canPyramidToday: true, avgEntryPrice: 100, dayClose: 102 }), thresholds);
      expect(signal.action).toBe('buy');
      expect(signal.trancheNumber).toBe(2);
    });

    it('does not set a limit price for tranche2 (market order — confirming momentum, not a dip entry)', () => {
      const signal = decideTrade(inputs({ ...holding, tranchesHeld: 1, canPyramidToday: true, avgEntryPrice: 100, dayClose: 102 }), thresholds);
      expect(signal.limitPrice).toBeUndefined();
    });

    it('does not add tranche 2 on the same day tranche 1 was opened', () => {
      const signal = decideTrade(inputs({ ...holding, tranchesHeld: 1, canPyramidToday: false, avgEntryPrice: 100, dayClose: 105 }), thresholds);
      expect(signal.action).toBe('hold');
    });

    it('does not add tranche 2 without enough favorable movement', () => {
      const signal = decideTrade(inputs({ ...holding, tranchesHeld: 1, canPyramidToday: true, avgEntryPrice: 100, dayClose: 100.5 }), thresholds);
      expect(signal.action).toBe('hold');
    });

    it('adds tranche 3 once RSI confirms an uptrend past the tranche-2 entry price', () => {
      const signal = decideTrade(
        inputs({ ...holding, tranchesHeld: 2, canPyramidToday: true, lastTrancheEntryPrice: 102, dayClose: 105, rsi14: 55 }),
        thresholds,
      );
      expect(signal.action).toBe('buy');
      expect(signal.trancheNumber).toBe(3);
    });

    it('does not add tranche 3 when RSI has not turned upward', () => {
      const signal = decideTrade(
        inputs({ ...holding, tranchesHeld: 2, canPyramidToday: true, lastTrancheEntryPrice: 102, dayClose: 105, rsi14: 45 }),
        thresholds,
      );
      expect(signal.action).toBe('hold');
    });

    it('does not add a 4th tranche once all 3 are held', () => {
      const signal = decideTrade(inputs({ ...holding, tranchesHeld: 3, canPyramidToday: true, avgEntryPrice: 100, dayClose: 150, rsi14: 80 }), thresholds);
      expect(signal.action).toBe('hold');
    });
  });
});
