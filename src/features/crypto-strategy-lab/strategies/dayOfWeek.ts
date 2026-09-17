import type { Strategy } from '../types.ts';

// 曜日アノマリー戦略。値動き・出来高・トレンドなど一切のテクニカル指標を
// 見ず、カレンダーだけで機械的に売買する——DCA（dca.ts）が「一定間隔」で
// 積み立てるのに対し、こちらは「特定の曜日」に売買する点が異なる。月曜に
// 買い、金曜に手仕舞う（週末を跨がず持ち越さない）という単純な仮説の検証。
const MAX_POSITION_YEN = 100_000;
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
        return { action: 'buy', budgetJpy: MAX_POSITION_YEN, reason: '月曜のため定例買い' };
      }
      return { action: 'skip', reason: '月曜以外は新規買いしない' };
    }

    if (s.dayOfWeek === SELL_DAY_OF_WEEK) {
      return { action: 'sell', reason: '金曜のため定例手仕舞い（週末持ち越しなし）' };
    }
    return { action: 'hold', reason: '金曜まで保有継続' };
  },
};
