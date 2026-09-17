import type { Strategy } from '../types.ts';

// クロスセクション・モメンタム戦略: 個別銘柄の値動きだけでなく、候補全体
// （16銘柄）の直近20日騰落率を比較し、上位TOP_N銘柄だけを均等配分で買う。
// 「強い銘柄はしばらく強いまま」という経験則に賭ける手法。ランキングから
// 落ちたら（TOP_Nから外れたら）手仕舞いする——他の9戦略が銘柄ごとに独立
// 判断するのに対し、これだけは他銘柄との相対比較が必要なためallSnapshots
// を使う。
const MAX_POSITION_YEN = 100_000;
const TOP_N = 3;

export const momentum: Strategy = {
  id: 'momentum',
  name: 'モメンタムランキング',
  description: '候補16銘柄の直近20日騰落率を比較し、上位3銘柄だけを均等配分で買う。ランキング外に落ちたら手仕舞い',
  decide(position, s, allSnapshots) {
    const ranked = [...allSnapshots].sort((a, b) => b.return20dPct - a.return20dPct);
    const topSymbols = new Set(ranked.slice(0, TOP_N).map((r) => r.symbol));
    const inTopN = topSymbols.has(s.symbol);
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;

    if (!hasPosition) {
      if (inTopN) {
        const rank = ranked.findIndex((r) => r.symbol === s.symbol) + 1;
        return { action: 'buy', budgetJpy: MAX_POSITION_YEN, reason: `20日騰落率${s.return20dPct.toFixed(1)}%で全銘柄中${rank}位、上位${TOP_N}入りのため買い` };
      }
      return { action: 'skip', reason: `上位${TOP_N}位内に入っていない` };
    }

    if (!inTopN) {
      return { action: 'sell', reason: `上位${TOP_N}位から陥落、手仕舞い` };
    }
    return { action: 'hold', reason: `引き続き上位${TOP_N}位内` };
  },
};
