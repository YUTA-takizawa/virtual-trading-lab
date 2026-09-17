import type { Strategy } from '../types.ts';

const MAX_POSITION_USD = 1_000;
const BREAKOUT_ATR_MULTIPLIER = 1.5;
const STOP_ATR_MULTIPLIER = 2;

export const atrBreakout: Strategy = {
  id: 'atr-breakout',
  name: 'ATRボラティリティブレイクアウト',
  description: '前日終値からATR（14日）の1.5倍以上動いたらブレイクとみなして買い、平均取得単価からATRの2倍下落したら損切り',
  decide(position, s) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;
    const priceMove = s.dayClose - s.dayClose / (1 + s.dailyMovePct / 100);

    if (!hasPosition) {
      if (priceMove >= s.atr14 * BREAKOUT_ATR_MULTIPLIER && s.dayClose > s.sma75) {
        return { action: 'buy', budgetUsd: MAX_POSITION_USD, reason: `ATR基準（14日ATR×${BREAKOUT_ATR_MULTIPLIER}）を超える上振れブレイクを検知、買い` };
      }
      return { action: 'skip', reason: 'ATR基準のブレイク未検知' };
    }

    const avgEntry = position!.lots.reduce((sum, l) => sum + l.quantity * l.entryPriceUsd, 0) / position!.lots.reduce((sum, l) => sum + l.quantity, 0);
    if (s.dayClose <= avgEntry - s.atr14 * STOP_ATR_MULTIPLIER) {
      return { action: 'sell', reason: `平均取得単価からATRの${STOP_ATR_MULTIPLIER}倍下落、ボラティリティ・ストップで損切り` };
    }
    return { action: 'hold', reason: 'ストップ未到達、保有継続' };
  },
};
