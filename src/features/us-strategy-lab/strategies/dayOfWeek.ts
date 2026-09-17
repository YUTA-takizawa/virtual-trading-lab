import type { Strategy } from '../types.ts';

const MAX_POSITION_USD = 1_000;
const BUY_DAY_OF_WEEK = 1; // 月曜
const SELL_DAY_OF_WEEK = 5; // 金曜

export const dayOfWeek: Strategy = {
  id: 'day-of-week',
  name: '曜日アノマリー',
  description: '値動きを一切見ず、毎週月曜に買い、金曜に手仕舞う。週末を跨いで持ち越さないという仮説の検証',
  decide(position, s) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;

    if (!hasPosition) {
      if (s.dayOfWeek === BUY_DAY_OF_WEEK) {
        return { action: 'buy', budgetUsd: MAX_POSITION_USD, reason: '月曜のため定例買い' };
      }
      return { action: 'skip', reason: '月曜以外は新規買いしない' };
    }

    if (s.dayOfWeek === SELL_DAY_OF_WEEK) {
      return { action: 'sell', reason: '金曜のため定例手仕舞い（週末持ち越しなし）' };
    }
    return { action: 'hold', reason: '金曜まで保有継続' };
  },
};
