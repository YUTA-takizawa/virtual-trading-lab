// 指標計算はすべて銘柄・通貨・資産クラスに依存しない純粋関数のため、
// crypto-strategy-lab/indicators.tsの実装をそのまま再利用する（二重実装を
// 避ける）。SMA50/SMA200・200日高値はcalcSma/calcHighestHighにそれぞれ
// period=50/200/200を渡すだけで新しい関数は不要。
export {
  calcRsi14,
  calcSma,
  calcVolumeRatio,
  calcStdDev,
  calcBollingerBands,
  calcHighestHigh,
  calcLowestLow,
  calcReturnPct,
  calcEmaSeries,
  calcMacd,
  calcAtr,
  calcStochastic,
  calcVwap,
  calcIchimokuTk,
  type BollingerBands,
  type MacdResult,
  type StochasticResult,
  type IchimokuTk,
} from '../crypto-strategy-lab/indicators.ts';

/**
 * Number of consecutive trailing down-days (today's close < yesterday's,
 * yesterday's < the day before, ...), stopping at the first non-down day.
 * 0 if today itself isn't down. Used by the consecutive-dip strategy's
 * mechanical "buy after N red days" rule — a pure price-action count with no
 * other indicator involved.
 */
export function calcConsecutiveDownDays(closes: number[]): number {
  let count = 0;
  for (let i = closes.length - 1; i > 0; i--) {
    if (closes[i]! < closes[i - 1]!) {
      count++;
    } else {
      break;
    }
  }
  return count;
}
