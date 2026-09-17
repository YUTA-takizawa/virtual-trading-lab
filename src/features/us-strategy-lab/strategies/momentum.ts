import type { Strategy } from '../types.ts';

// 候補122銘柄の直近20日騰落率を比較し、上位TOP_N銘柄だけを均等配分で買う
// クロスセクション・モメンタム戦略。暗号資産版は候補16銘柄中の上位3だったが、
// 米国株版は候補が122銘柄と大幅に多いため、上位5に広げる。
const MAX_POSITION_USD = 1_000;
const TOP_N = 5;

export const momentum: Strategy = {
  id: 'momentum',
  name: 'モメンタムランキング',
  description: '候補122銘柄の直近20日騰落率を比較し、上位5銘柄だけを均等配分で買う。ランキング外に落ちたら手仕舞い',
  decide(position, s, allSnapshots) {
    const ranked = [...allSnapshots].sort((a, b) => b.return20dPct - a.return20dPct);
    const topSymbols = new Set(ranked.slice(0, TOP_N).map((r) => r.symbol));
    const inTopN = topSymbols.has(s.symbol);
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;

    if (!hasPosition) {
      if (inTopN) {
        const rank = ranked.findIndex((r) => r.symbol === s.symbol) + 1;
        return { action: 'buy', budgetUsd: MAX_POSITION_USD, reason: `20日騰落率${s.return20dPct.toFixed(1)}%で全銘柄中${rank}位、上位${TOP_N}入りのため買い` };
      }
      return { action: 'skip', reason: `上位${TOP_N}位内に入っていない` };
    }

    if (!inTopN) {
      return { action: 'sell', reason: `上位${TOP_N}位から陥落、手仕舞い` };
    }
    return { action: 'hold', reason: `引き続き上位${TOP_N}位内` };
  },
};
