import type { Strategy } from '../types.ts';

const MAX_POSITION_USD = 1_000;

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
        return { action: 'buy', budgetUsd: MAX_POSITION_USD, reason: 'MACD線がシグナル線を上抜け、買いシグナル' };
      }
      return { action: 'skip', reason: 'クロス未発生' };
    }

    if (deadCross) {
      return { action: 'sell', reason: 'MACD線がシグナル線を下抜け、売りシグナル' };
    }
    return { action: 'hold', reason: 'クロス未発生、保有継続' };
  },
};
