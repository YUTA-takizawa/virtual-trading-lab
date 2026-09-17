import type { Strategy } from '../types.ts';

// テクニカル指標を一切見ない、機械的な定期積立（ドルコスト平均法）。
// 直近の買いから一定日数（INTERVAL_DAYS）経っていれば、値動きに関係なく
// 定額を買い増す。損切りはせず、含み益が目標（PROFIT_TARGET_PCT）に
// 達したときだけ全部売って利確する——「積立を続ける」という前提を崩さない
// ため、途中の下落で投げ売りしない設計。
const MAX_POSITION_YEN = 100_000;
const BUY_COUNT_TARGET = 12; // 100,000円を12回に分けて積み立てる想定
const BUY_AMOUNT_JPY = MAX_POSITION_YEN / BUY_COUNT_TARGET;
const INTERVAL_DAYS = 7;
const PROFIT_TARGET_PCT = 50;

function daysSince(dateStr: string, today: string): number {
  return (new Date(today).getTime() - new Date(dateStr).getTime()) / (24 * 60 * 60 * 1000);
}

export const dca: Strategy = {
  id: 'dca',
  name: 'ドルコスト平均法（DCA）',
  description: '値動きを見ず、7日ごとに定額（約8,333円）を機械的に買い増す。含み益+50%到達時のみ全部売って利確、それ以外は損切りしない',
  decide(position, s) {
    const lots = position?.lots ?? [];
    const totalSpent = lots.reduce((sum, l) => sum + l.quantity * l.entryPriceJpy, 0);
    const totalQuantity = lots.reduce((sum, l) => sum + l.quantity, 0);

    if (totalQuantity > 0) {
      const avgEntry = totalSpent / totalQuantity;
      const unrealizedPct = ((s.dayClose - avgEntry) / avgEntry) * 100;
      if (unrealizedPct >= PROFIT_TARGET_PCT) {
        return { action: 'sell', reason: `平均取得単価比+${unrealizedPct.toFixed(0)}%に到達、目標利益確定売り` };
      }
    }

    const lastEntryDate = lots.at(-1)?.entryDate;
    const dueForNextBuy = totalSpent >= MAX_POSITION_YEN ? false : !lastEntryDate || daysSince(lastEntryDate, s.date) >= INTERVAL_DAYS;
    if (dueForNextBuy) {
      return { action: 'buy', budgetJpy: BUY_AMOUNT_JPY, reason: `前回積立から${INTERVAL_DAYS}日経過、定額積立買い` };
    }
    return { action: 'hold', reason: '次回積立日までホールド' };
  },
};
