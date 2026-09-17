import { describe, expect, it } from 'vitest';
import { calcRsi14, calcSma, calcVolumeRatio } from '../../../src/features/daytrade-sim/indicators.ts';

describe('calcRsi14', () => {
  it('returns 100 when every change over the window is a gain', () => {
    const closes = Array.from({ length: 15 }, (_, i) => 100 + i);
    expect(calcRsi14(closes)).toBe(100);
  });

  it('returns 0 when every change over the window is a loss', () => {
    const closes = Array.from({ length: 15 }, (_, i) => 114 - i);
    expect(calcRsi14(closes)).toBe(0);
  });

  it('returns 50 when there is no movement at all', () => {
    const closes = Array(15).fill(100);
    expect(calcRsi14(closes)).toBe(50);
  });

  it('computes the standard RSI formula for a mixed gain/loss window', () => {
    // Alternating +2/-1 over 14 changes: avgGain = 14/14 = 1, avgLoss = 7/14 = 0.5, RS = 2
    const closes = [100, 102, 101, 103, 102, 104, 103, 105, 104, 106, 105, 107, 106, 108, 107];
    expect(calcRsi14(closes)).toBeCloseTo(66.6667, 3);
  });

  it('only considers the most recent 15 closes when more history is given', () => {
    const noisyPrefix = [500, 1, 900, 2, 800];
    const flatWindow = Array(15).fill(100);
    expect(calcRsi14([...noisyPrefix, ...flatWindow])).toBe(50);
  });

  it('throws when there is not enough history', () => {
    expect(() => calcRsi14(Array(14).fill(100))).toThrow();
  });
});

describe('calcVolumeRatio', () => {
  it('divides today\'s volume by the trailing window average', () => {
    const volumes = [...Array(19).fill(1000), 2000];
    expect(calcVolumeRatio(volumes)).toBe(2);
  });

  it('uses only as much trailing history as is available when shorter than the window', () => {
    const volumes = [1000, 1000, 1000, 3000];
    expect(calcVolumeRatio(volumes)).toBe(3);
  });

  it('returns 0 when there is no trailing history to compare against', () => {
    expect(calcVolumeRatio([1000])).toBe(0);
  });

  it('returns 0 rather than dividing by zero when the trailing average is zero', () => {
    expect(calcVolumeRatio([0, 0, 0, 1000])).toBe(0);
  });
});

describe('calcSma', () => {
  it('averages exactly the trailing `period` closes', () => {
    const closes = [10, 20, 30, 40, 50];
    expect(calcSma(closes, 3)).toBeCloseTo((30 + 40 + 50) / 3, 8);
  });

  it('ignores anything older than the requested period', () => {
    const noisyPrefix = [9999, -9999, 9999];
    const flatWindow = Array(10).fill(100);
    expect(calcSma([...noisyPrefix, ...flatWindow], 10)).toBe(100);
  });

  it('throws when there is not enough history for the requested period', () => {
    expect(() => calcSma(Array(74).fill(100), 75)).toThrow();
  });

  it('does not throw with exactly `period` closes', () => {
    expect(calcSma(Array(75).fill(100), 75)).toBe(100);
  });
});
