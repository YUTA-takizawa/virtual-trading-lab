import type { Strategy } from '../types.ts';

const MAX_POSITION_USD = 1_000;

export const maCross: Strategy = {
  id: 'ma-cross',
  name: '移動平均クロス（25日/75日）',
  description: '短期線（25日）が長期線（75日）を上抜けたら買い（ゴールデンクロス）、下抜けたら売り（デッドクロス）',
  decide(position, s) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;
    const goldenCross = s.prevSma25 <= s.prevSma75 && s.sma25 > s.sma75;
    const deadCross = s.prevSma25 >= s.prevSma75 && s.sma25 < s.sma75;

    if (!hasPosition) {
      if (goldenCross) {
        return { action: 'buy', budgetUsd: MAX_POSITION_USD, reason: 'ゴールデンクロス（25日線が75日線を上抜け）を検知' };
      }
      return { action: 'skip', reason: 'クロス未発生' };
    }

    if (deadCross) {
      return { action: 'sell', reason: 'デッドクロス（25日線が75日線を下抜け）を検知' };
    }
    return { action: 'hold', reason: 'クロス未発生、保有継続' };
  },
};
