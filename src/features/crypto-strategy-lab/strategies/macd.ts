import type { Strategy } from '../types.ts';

// 定番のMACD（12/26/9）クロス戦略。MACD線（EMA12-EMA26）がシグナル線
// （MACD線のEMA9）を上抜けたら買い、下抜けたら売り。移動平均クロス
// （maCross.ts）と考え方は近いが、単純移動平均ではなく指数移動平均の
// 差分（トレンドの勢いの変化）を見る点が異なる。
const MAX_POSITION_YEN = 100_000;

export const macd: Strategy = {
  id: 'macd',
  name: 'MACD（12/26/9）',
  description: 'MACD線（EMA12-EMA26）がシグナル線を上抜けたら買い、下抜けたら売り',
  decide(position, s) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;
    const goldenCross = s.prevMacd <= s.prevMacdSignal && s.macd > s.macdSignal;
    const deadCross = s.prevMacd >= s.prevMacdSignal && s.macd < s.macdSignal;

    if (!hasPosition) {
      if (goldenCross) {
        return { action: 'buy', budgetJpy: MAX_POSITION_YEN, reason: 'MACD線がシグナル線を上抜け、買いシグナル' };
      }
      return { action: 'skip', reason: 'クロス未発生' };
    }

    if (deadCross) {
      return { action: 'sell', reason: 'MACD線がシグナル線を下抜け、売りシグナル' };
    }
    return { action: 'hold', reason: 'クロス未発生、保有継続' };
  },
};
