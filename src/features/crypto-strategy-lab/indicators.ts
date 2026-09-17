// RSI14/SMA/出来高比は既存実装をそのまま再利用（銘柄・資産クラス非依存）。
export { calcRsi14, calcSma, calcVolumeRatio } from '../daytrade-sim/indicators.ts';

/**
 * Population standard deviation of the trailing `period` closes — the width
 * component of a Bollinger Band. Same "throw if not enough history" contract
 * as calcSma/calcRsi14.
 */
export function calcStdDev(closes: number[], period: number): number {
  if (closes.length < period) {
    throw new Error(`calcStdDev needs at least ${period} daily closes, got ${closes.length}`);
  }
  const recent = closes.slice(-period);
  const mean = recent.reduce((sum, c) => sum + c, 0) / recent.length;
  const variance = recent.reduce((sum, c) => sum + (c - mean) ** 2, 0) / recent.length;
  return Math.sqrt(variance);
}

export interface BollingerBands {
  mid: number; // SMA(period)
  upper: number; // mid + widthMultiplier * stddev
  lower: number; // mid - widthMultiplier * stddev
}

/** Standard 20-day/2σ Bollinger Bands by convention (widthMultiplier defaults to 2). */
export function calcBollingerBands(closes: number[], period = 20, widthMultiplier = 2): BollingerBands {
  const mid = closes.slice(-period).reduce((sum, c) => sum + c, 0) / period;
  const stddev = calcStdDev(closes, period);
  return { mid, upper: mid + widthMultiplier * stddev, lower: mid - widthMultiplier * stddev };
}

/** Highest high over the trailing `period` days (inclusive of today) — the breakout strategy's reference line. */
export function calcHighestHigh(highs: number[], period: number): number {
  if (highs.length < period) {
    throw new Error(`calcHighestHigh needs at least ${period} daily highs, got ${highs.length}`);
  }
  return Math.max(...highs.slice(-period));
}

/** Lowest low over the trailing `period` days (inclusive of today). */
export function calcLowestLow(lows: number[], period: number): number {
  if (lows.length < period) {
    throw new Error(`calcLowestLow needs at least ${period} daily lows, got ${lows.length}`);
  }
  return Math.min(...lows.slice(-period));
}

/** % change from the close `period` days ago to today's close — the momentum-ranking strategy's ranking metric. */
export function calcReturnPct(closes: number[], period: number): number {
  if (closes.length < period + 1) {
    throw new Error(`calcReturnPct needs at least ${period + 1} daily closes, got ${closes.length}`);
  }
  const past = closes.at(-1 - period)!;
  const current = closes.at(-1)!;
  return ((current - past) / past) * 100;
}

// --- 2026年8月31日追加: 10戦略ラボをさらに12戦略拡張するための指標 ---

/**
 * Exponential moving average series (oldest-to-newest, aligned to the input
 * from index `period - 1` onward), seeded by a simple average of the first
 * `period` closes. Returns the *series*, not just the latest value, because
 * MACD's signal line needs an EMA of the MACD series itself, which requires
 * the whole trailing history, not just today's number.
 */
export function calcEmaSeries(closes: number[], period: number): number[] {
  if (closes.length < period) {
    throw new Error(`calcEmaSeries needs at least ${period} daily closes, got ${closes.length}`);
  }
  const k = 2 / (period + 1);
  const seed = closes.slice(0, period).reduce((sum, c) => sum + c, 0) / period;
  const series = [seed];
  for (let i = period; i < closes.length; i++) {
    series.push(closes[i]! * k + series.at(-1)! * (1 - k));
  }
  return series;
}

export interface MacdResult {
  macd: number;
  signal: number;
}

/** Standard 12/26/9 MACD: macd = EMA12 - EMA26, signal = EMA9 of the macd series. */
export function calcMacd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const emaFast = calcEmaSeries(closes, fast);
  const emaSlow = calcEmaSeries(closes, slow);
  // emaFast is longer (started earlier) than emaSlow since fast < slow; align to emaSlow's length (both end at "today").
  const macdSeries = emaSlow.map((slowVal, i) => emaFast[emaFast.length - emaSlow.length + i]! - slowVal);
  if (macdSeries.length < signalPeriod) {
    throw new Error(`calcMacd needs at least ${slow + signalPeriod} daily closes to compute the signal line, got ${closes.length}`);
  }
  const signalSeries = calcEmaSeries(macdSeries, signalPeriod);
  return { macd: macdSeries.at(-1)!, signal: signalSeries.at(-1)! };
}

/** True Range averaged over `period` days (Wilder's ATR, simple-average variant rather than the exponential smoothing original — same v1-simplification convention as calcRsi14). */
export function calcAtr(highs: number[], lows: number[], closes: number[], period = 14): number {
  if (closes.length < period + 1) {
    throw new Error(`calcAtr needs at least ${period + 1} daily bars, got ${closes.length}`);
  }
  const trueRanges: number[] = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    const highLow = highs[i]! - lows[i]!;
    const highPrevClose = Math.abs(highs[i]! - closes[i - 1]!);
    const lowPrevClose = Math.abs(lows[i]! - closes[i - 1]!);
    trueRanges.push(Math.max(highLow, highPrevClose, lowPrevClose));
  }
  return trueRanges.reduce((sum, tr) => sum + tr, 0) / trueRanges.length;
}

export interface StochasticResult {
  k: number;
  d: number;
}

/** Stochastic oscillator: %K = (close - lowestLow(period)) / (highestHigh(period) - lowestLow(period)) * 100, %D = SMA(%K, smoothD). */
export function calcStochastic(highs: number[], lows: number[], closes: number[], period = 14, smoothD = 3): StochasticResult {
  if (closes.length < period + smoothD - 1) {
    throw new Error(`calcStochastic needs at least ${period + smoothD - 1} daily bars, got ${closes.length}`);
  }
  const kValues: number[] = [];
  for (let end = closes.length - smoothD; end < closes.length; end++) {
    const windowHighs = highs.slice(end - period + 1, end + 1);
    const windowLows = lows.slice(end - period + 1, end + 1);
    const highestHigh = Math.max(...windowHighs);
    const lowestLow = Math.min(...windowLows);
    const range = highestHigh - lowestLow;
    kValues.push(range === 0 ? 50 : ((closes[end]! - lowestLow) / range) * 100);
  }
  return { k: kValues.at(-1)!, d: kValues.reduce((sum, k) => sum + k, 0) / kValues.length };
}

/** Volume-weighted average price over the trailing `period` days. */
export function calcVwap(closes: number[], volumes: number[], period = 20): number {
  if (closes.length < period) {
    throw new Error(`calcVwap needs at least ${period} daily bars, got ${closes.length}`);
  }
  const recentCloses = closes.slice(-period);
  const recentVolumes = volumes.slice(-period);
  const totalVolume = recentVolumes.reduce((sum, v) => sum + v, 0);
  if (totalVolume === 0) return recentCloses.at(-1)!;
  const totalValue = recentCloses.reduce((sum, c, i) => sum + c * recentVolumes[i]!, 0);
  return totalValue / totalVolume;
}

export interface IchimokuTk {
  tenkanSen: number; // 転換線: (9日高値+9日安値)/2
  kijunSen: number; // 基準線: (26日高値+26日安値)/2
}

/**
 * Simplified Ichimoku: only 転換線/基準線（tenkan/kijun）, not the full cloud
 * (先行スパンA/B, 26日先行表示). The cloud is deliberately omitted — it's
 * plotted 26 periods *ahead* of price, which fits a chart but doesn't map
 * cleanly onto a same-day buy/sell decision the way a TK cross does.
 */
export function calcIchimokuTk(highs: number[], lows: number[], tenkanPeriod = 9, kijunPeriod = 26): IchimokuTk {
  if (highs.length < kijunPeriod) {
    throw new Error(`calcIchimokuTk needs at least ${kijunPeriod} daily bars, got ${highs.length}`);
  }
  const tenkanHighs = highs.slice(-tenkanPeriod);
  const tenkanLows = lows.slice(-tenkanPeriod);
  const kijunHighs = highs.slice(-kijunPeriod);
  const kijunLows = lows.slice(-kijunPeriod);
  return {
    tenkanSen: (Math.max(...tenkanHighs) + Math.min(...tenkanLows)) / 2,
    kijunSen: (Math.max(...kijunHighs) + Math.min(...kijunLows)) / 2,
  };
}
