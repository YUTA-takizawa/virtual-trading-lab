import type { Strategy } from '../types.ts';

// 逆張り（contrarian）とは正反対の哲学: 押し目を待たず、上昇トレンドが
// 確認できたらすぐ乗る順張り。急落は買わない・むしろ避ける。
const MAX_POSITION_YEN = 100_000;
const TREND_MARGIN_PCT = 2; // 75日移動平均をこの%以上上回っていることを「明確な上昇トレンド」の条件にする

export const trendFollow: Strategy = {
  id: 'trend-follow',
  name: '順張り（トレンドフォロー）',
  description: '75日移動平均を明確に上回り、かつ当日が陽線なら即買い。押し目を待たない。移動平均を下回ったら手仕舞い',
  decide(position, s) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;
    const trendLine = s.sma75 * (1 + TREND_MARGIN_PCT / 100);

    if (!hasPosition) {
      if (s.dayClose > trendLine && s.dailyMovePct > 0) {
        return { action: 'buy', budgetJpy: MAX_POSITION_YEN, reason: `75日移動平均を${TREND_MARGIN_PCT}%超上回る上昇トレンドを確認、押し目を待たず買い` };
      }
      return { action: 'skip', reason: 'トレンド未確認のため見送り' };
    }

    if (s.dayClose < s.sma75) {
      return { action: 'sell', reason: '75日移動平均を割り込みトレンド終了と判断、手仕舞い' };
    }
    return { action: 'hold', reason: 'トレンド継続中' };
  },
};
