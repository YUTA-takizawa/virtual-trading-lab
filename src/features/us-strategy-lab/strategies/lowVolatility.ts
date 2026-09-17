import type { Strategy } from '../types.ts';

// 「低ボラティリティ・アノマリー」（値動きが穏やかな銘柄群の方が、長期的な
// リスク調整後リターンでは意外と高値動きの激しい銘柄群に劣らない、という
// 実証研究で知られる経験則）に賭けるクロスセクション戦略。モメンタム
// ランキング（momentum.ts）が「強い（値上がりした）銘柄」を追いかけるのと
// 正反対に、こちらは「動きが穏やかな銘柄」を積極的に選ぶ——値動きの荒さを
// ATR14/終値の比率で候補全体を比較し、最も穏やかな上位N銘柄を均等配分で買う。
const MAX_POSITION_USD = 1_000;
const TOP_N = 5;

function volatilityRatio(s: { atr14: number; dayClose: number }): number {
  return s.atr14 / s.dayClose;
}

export const lowVolatility: Strategy = {
  id: 'low-volatility',
  name: '低ボラティリティ選好',
  description: '候補122銘柄をATR14/終値の比率（値動きの荒さ）で比較し、最も穏やかな上位5銘柄だけを均等配分で買う。低ボラティリティ・アノマリーへの賭け',
  decide(position, s, allSnapshots) {
    const ranked = [...allSnapshots].sort((a, b) => volatilityRatio(a) - volatilityRatio(b));
    const topSymbols = new Set(ranked.slice(0, TOP_N).map((r) => r.symbol));
    const inTopN = topSymbols.has(s.symbol);
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;

    if (!hasPosition) {
      if (inTopN) {
        const rank = ranked.findIndex((r) => r.symbol === s.symbol) + 1;
        return { action: 'buy', budgetUsd: MAX_POSITION_USD, reason: `値動きの穏やかさ（ATR/終値比）で全銘柄中${rank}位、上位${TOP_N}入りのため買い` };
      }
      return { action: 'skip', reason: `上位${TOP_N}位内に入っていない` };
    }

    if (!inTopN) {
      return { action: 'sell', reason: `上位${TOP_N}位から陥落（値動きが荒くなった）、手仕舞い` };
    }
    return { action: 'hold', reason: `引き続き上位${TOP_N}位内` };
  },
};
