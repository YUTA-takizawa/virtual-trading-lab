import type { Strategy } from '../types.ts';

// ペアトレードの簡易版（ロングオンリー、空売り非対応のため片方を買うだけ）。
// 対象はGOOGL（Alphabet Class A）とGOOG（Class C）——同一企業の異なる株式
// クラスで、通常はほぼ完全に連動する（議決権の有無以外に実質的な差がない）
// はずの組み合わせ。一時的に価格が乖離したら出遅れた方を買い、差が縮まったら
// 利確する。GOOGL判定時にのみallSnapshotsからGOOGを参照する。他の銘柄では
// 常にskip。
const MAX_POSITION_USD = 1_000;
const PRIMARY_SYMBOL = 'GOOGL';
const PAIR_SYMBOL = 'GOOG';
const LAG_THRESHOLD_PCT = 1; // 同一企業の株式クラス間なので、暗号資産版（BTC/ETH、5%）よりずっと小さい乖離で反応する

export const relativeStrengthPair: Strategy = {
  id: 'relative-strength-pair',
  name: '相対強弱ペア（GOOGL/GOOG）',
  description: '同一企業の異なる株式クラスであるGOOGLとGOOGの75日トレンド比の相対パフォーマンスを比較し、出遅れている方が1%以上劣後したら買い、差が縮まったら利確',
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
        return { action: 'buy', budgetUsd: MAX_POSITION_USD, reason: `${PAIR_SYMBOL}比でトレンド相対強度が${lagPct.toFixed(1)}%出遅れ、追いつきを狙って買い` };
      }
      return { action: 'skip', reason: '出遅れ幅が閾値未満' };
    }

    if (lagPct >= 0) {
      return { action: 'sell', reason: `${PAIR_SYMBOL}との相対強度の差が解消、利益確定` };
    }
    return { action: 'hold', reason: 'まだ出遅れ状態、保有継続' };
  },
};
