import type { Strategy } from '../types.ts';

// ペアトレードの簡易版（ロングオンリー）。本来のペアトレードは相関の高い
// 2銘柄の片方を買い・片方を空売りして価格差の平均回帰を狙うが、この
// プラットフォームは現物想定で空売りに対応していないため、「一時的に
// 出遅れている方を買い、追いついたら利確する」という長期反転の簡易版に
// している（意図的な簡略化）。対象はBTC-JPYとETH-JPY——暗号資産の中でも
// 特に相関が強いとされる2銘柄のペア。BTC-JPYの判定時にのみallSnapshots
// からETH-JPYを参照する。他の銘柄では常にskip。
const MAX_POSITION_YEN = 100_000;
const PRIMARY_SYMBOL = 'BTC-JPY';
const PAIR_SYMBOL = 'ETH-JPY';
const LAG_THRESHOLD_PCT = 5; // 相手より75日トレンド比でこの%以上出遅れたら買い

export const relativeStrengthPair: Strategy = {
  id: 'relative-strength-pair',
  name: '相対強弱ペア（BTC/ETH）',
  description: 'BTCとETHの75日トレンド比の相対パフォーマンスを比較し、出遅れている方（BTC想定）が5%以上劣後したら買い、差が縮まったら利確。空売り非対応のためロングオンリーの簡易ペアトレード',
  decide(position, s, allSnapshots) {
    if (s.symbol !== PRIMARY_SYMBOL) {
      return { action: 'skip', reason: `このペア戦略は${PRIMARY_SYMBOL}でのみ判断する` };
    }
    const pair = allSnapshots.find((snap) => snap.symbol === PAIR_SYMBOL);
    if (!pair) {
      return { action: 'skip', reason: `比較対象の${PAIR_SYMBOL}のデータが取得できていない` };
    }

    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;
    const primaryRelStrength = (s.dayClose / s.sma75) * 100;
    const pairRelStrength = (pair.dayClose / pair.sma75) * 100;
    const lagPct = primaryRelStrength - pairRelStrength;

    if (!hasPosition) {
      if (lagPct <= -LAG_THRESHOLD_PCT) {
        return { action: 'buy', budgetJpy: MAX_POSITION_YEN, reason: `${PAIR_SYMBOL}比でトレンド相対強度が${lagPct.toFixed(1)}%出遅れ、追いつきを狙って買い` };
      }
      return { action: 'skip', reason: '出遅れ幅が閾値未満' };
    }

    if (lagPct >= 0) {
      return { action: 'sell', reason: `${PAIR_SYMBOL}との相対強度の差が解消、利益確定` };
    }
    return { action: 'hold', reason: 'まだ出遅れ状態、保有継続' };
  },
};
