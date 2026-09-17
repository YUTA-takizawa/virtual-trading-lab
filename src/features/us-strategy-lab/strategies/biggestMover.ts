import type { Strategy } from '../types.ts';

// 「とんでもない買い方でもなんでもいい」というユーザー要望に応えた、
// 最も投機的な戦略。候補122銘柄の中でその日いちばん値動きが激しかった
// 銘柄（上げでも下げでも絶対値が最大の銘柄）だけを買い、理由の分析は
// 一切せず、翌日には無条件で手仕舞う——保有期間を1営業日に固定した
// 「値幅ロト」。値幅ランキング（momentum.ts、20日騰落率で順張り）や低
// ボラティリティ選好（lowVolatility.ts）とは対照的に、値動きの大きさ
// そのものを理由にする点が特徴。
const MAX_POSITION_USD = 1_000;

export const biggestMover: Strategy = {
  id: 'biggest-mover',
  name: '値幅ロト（本日の最大値動き銘柄）',
  description: '候補122銘柄の中でその日いちばん値動き（絶対値）が激しかった1銘柄だけを買い、翌営業日には無条件で手仕舞う。保有期間を1日に固定した投機的な「値幅ロト」',
  decide(position, s, allSnapshots) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;

    if (hasPosition) {
      const entryDate = position!.lots[0]!.entryDate;
      if (entryDate !== s.date) {
        return { action: 'sell', reason: '保有期間1日の上限に到達、理由を問わず無条件で手仕舞い' };
      }
      return { action: 'hold', reason: '本日買ったばかりのため保有継続' };
    }

    const biggest = allSnapshots.reduce((max, cur) => (Math.abs(cur.dailyMovePct) > Math.abs(max.dailyMovePct) ? cur : max));
    if (biggest.symbol === s.symbol) {
      return { action: 'buy', budgetUsd: MAX_POSITION_USD, reason: `本日の値動き${s.dailyMovePct.toFixed(1)}%で全銘柄中最大、値幅ロトとして買い` };
    }
    return { action: 'skip', reason: '本日の最大値動き銘柄ではない' };
  },
};
