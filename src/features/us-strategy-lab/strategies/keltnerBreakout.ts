import type { Strategy } from '../types.ts';

const MAX_POSITION_USD = 1_000;
const ATR_MULTIPLIER = 2;

export const keltnerBreakout: Strategy = {
  id: 'keltner-breakout',
  name: 'ケルトナーチャネル・ブレイクアウト',
  description: '25日移動平均±ATR14×2のチャネル上限を上抜けたら買い（順張り）、中心線を割ったら手仕舞い',
  decide(position, s) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;
    const upperBand = s.sma25 + s.atr14 * ATR_MULTIPLIER;

    if (!hasPosition) {
      if (s.dayClose > upperBand) {
        return { action: 'buy', budgetUsd: MAX_POSITION_USD, reason: `ケルトナーチャネル上限（25日移動平均+ATR×${ATR_MULTIPLIER}）を上抜け、順張り買い` };
      }
      return { action: 'skip', reason: 'チャネル上限未到達' };
    }

    if (s.dayClose < s.sma25) {
      return { action: 'sell', reason: '中心線（25日移動平均）を割り込み、手仕舞い' };
    }
    return { action: 'hold', reason: 'チャネル内、保有継続' };
  },
};
