import type { Strategy } from '../types.ts';

const MAX_POSITION_USD = 1_000;
const BUY_COUNT_TARGET = 12;
const BUY_AMOUNT_USD = MAX_POSITION_USD / BUY_COUNT_TARGET;
const INTERVAL_DAYS = 7;
const PROFIT_TARGET_PCT = 50;

function daysSince(dateStr: string, today: string): number {
  return (new Date(today).getTime() - new Date(dateStr).getTime()) / (24 * 60 * 60 * 1000);
}

export const dca: Strategy = {
  id: 'dca',
  name: 'ドルコスト平均法（DCA）',
  description: '値動きを見ず、7日ごとに定額（約$83）を機械的に買い増す。含み益+50%到達時のみ全部売って利確、それ以外は損切りしない',
  decide(position, s) {
    const lots = position?.lots ?? [];
    const totalSpent = lots.reduce((sum, l) => sum + l.quantity * l.entryPriceUsd, 0);
    const totalQuantity = lots.reduce((sum, l) => sum + l.quantity, 0);

    if (totalQuantity > 0) {
      const avgEntry = totalSpent / totalQuantity;
      const unrealizedPct = ((s.dayClose - avgEntry) / avgEntry) * 100;
      if (unrealizedPct >= PROFIT_TARGET_PCT) {
        return { action: 'sell', reason: `平均取得単価比+${unrealizedPct.toFixed(0)}%に到達、目標利益確定売り` };
      }
    }

    const lastEntryDate = lots.at(-1)?.entryDate;
    const dueForNextBuy = totalSpent >= MAX_POSITION_USD ? false : !lastEntryDate || daysSince(lastEntryDate, s.date) >= INTERVAL_DAYS;
    if (dueForNextBuy) {
      return { action: 'buy', budgetUsd: BUY_AMOUNT_USD, reason: `前回積立から${INTERVAL_DAYS}日経過、定額積立買い` };
    }
    return { action: 'hold', reason: '次回積立日までホールド' };
  },
};
