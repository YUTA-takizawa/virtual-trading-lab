import { describe, expect, it } from 'vitest';
import {
  calcBollingerBands,
  calcHighestHigh,
  calcLowestLow,
  calcReturnPct,
  calcStdDev,
  calcEmaSeries,
  calcMacd,
  calcAtr,
  calcStochastic,
  calcVwap,
  calcIchimokuTk,
} from '../../../src/features/crypto-strategy-lab/indicators.ts';

describe('calcStdDev', () => {
  it('computes population standard deviation of the trailing period', () => {
    // [2,4,4,4,5,5,7,9] has a well-known population stddev of 2 (classic textbook example)
    const closes = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(calcStdDev(closes, 8)).toBeCloseTo(2, 8);
  });

  it('throws when there is not enough history', () => {
    expect(() => calcStdDev([1, 2], 5)).toThrow();
  });
});

describe('calcBollingerBands', () => {
  it('computes mid (SMA) and upper/lower bands at +/- widthMultiplier * stddev', () => {
    const closes = [2, 4, 4, 4, 5, 5, 7, 9];
    const bands = calcBollingerBands(closes, 8, 2);
    const expectedMid = closes.reduce((s, c) => s + c, 0) / closes.length; // 5
    expect(bands.mid).toBeCloseTo(expectedMid, 8);
    expect(bands.upper).toBeCloseTo(expectedMid + 2 * 2, 8);
    expect(bands.lower).toBeCloseTo(expectedMid - 2 * 2, 8);
  });
});

describe('calcHighestHigh / calcLowestLow', () => {
  it('finds the max/min over the trailing period, ignoring older bars outside it', () => {
    const highs = [100, 200, 50, 60, 70]; // period=3 -> only [50,60,70] considered
    const lows = [1, 2, 30, 20, 25];
    expect(calcHighestHigh(highs, 3)).toBe(70);
    expect(calcLowestLow(lows, 3)).toBe(20);
  });

  it('throws when there is not enough history', () => {
    expect(() => calcHighestHigh([1, 2], 5)).toThrow();
    expect(() => calcLowestLow([1, 2], 5)).toThrow();
  });
});

describe('calcReturnPct', () => {
  it('computes % change from N days ago to the latest close', () => {
    const closes = [100, 105, 110, 90, 120]; // period=4 -> from closes[0]=100 to closes[4]=120
    expect(calcReturnPct(closes, 4)).toBeCloseTo(20, 8);
  });

  it('throws when there is not enough history', () => {
    expect(() => calcReturnPct([100, 105], 5)).toThrow();
  });
});

describe('calcEmaSeries', () => {
  it('equals the constant value for a flat series', () => {
    const flat = new Array(30).fill(100);
    expect(calcEmaSeries(flat, 10).at(-1)).toBeCloseTo(100, 8);
  });

  it('throws when there is not enough history', () => {
    expect(() => calcEmaSeries([1, 2], 10)).toThrow();
  });
});

describe('calcMacd', () => {
  it('is positive and roughly stable for a steady linear uptrend', () => {
    const upTrend = Array.from({ length: 60 }, (_, i) => 100 + i);
    const { macd, signal } = calcMacd(upTrend);
    expect(macd).toBeGreaterThan(0);
    expect(macd).toBeCloseTo(signal, 1); // a constant-slope trend makes macd/signal converge
  });
});

describe('calcAtr', () => {
  it('equals the constant daily range when high-low is fixed and there are no gaps', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const highs = closes.map((c) => c + 2);
    const lows = closes.map((c) => c - 2);
    expect(calcAtr(highs, lows, closes, 14)).toBeCloseTo(4, 8);
  });
});

describe('calcStochastic', () => {
  it('computes %K from today\'s position within the trailing high/low range', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const highs = closes.map((c) => c + 2);
    const lows = closes.map((c) => c - 2);
    const { k } = calcStochastic(highs, lows, closes, 14, 3);
    // highestHigh(14) = closes[19]+2, lowestLow(14) = closes[6]-2, range = 13 (index span) + 4 = 17
    const expectedK = ((closes[19]! - (closes[6]! - 2)) / 17) * 100;
    expect(k).toBeCloseTo(expectedK, 6);
  });
});

describe('calcVwap', () => {
  it('equals the simple average of closes when volume is constant', () => {
    const closes = [10, 20, 30, 40];
    const volumes = [100, 100, 100, 100];
    expect(calcVwap(closes, volumes, 4)).toBeCloseTo(25, 8);
  });

  it('weights toward the higher-volume days', () => {
    const closes = [10, 100];
    const volumes = [1, 999]; // almost all volume at the 100 price point
    expect(calcVwap(closes, volumes, 2)).toBeGreaterThan(90);
  });
});

describe('calcIchimokuTk', () => {
  it('computes tenkan/kijun as the midpoint of the trailing high/low range', () => {
    const highs = [10, 11, 12, 13, 14, 15, 16, 17, 18]; // 9 bars
    const lows = highs.map((h) => h - 2);
    const { tenkanSen, kijunSen } = calcIchimokuTk(highs, lows, 9, 9); // same period for both to check the formula directly
    const expected = (18 + (10 - 2)) / 2;
    expect(tenkanSen).toBeCloseTo(expected, 8);
    expect(kijunSen).toBeCloseTo(expected, 8);
  });
});
