import type { Strategy } from '../types.ts';

const MAX_POSITION_USD = 1_000;
const DEVIATION_PCT = 5;

export const vwapDeviation: Strategy = {
  id: 'vwap-deviation',
  name: 'VWAP乖離',
  description: '20日出来高加重平均線（VWAP）から5%以上下に乖離したら買い、VWAPまで戻ったら利確',
  decide(position, s) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;
    const deviationPct = ((s.dayClose - s.vwap20) / s.vwap20) * 100;

    if (!hasPosition) {
      if (deviationPct <= -DEVIATION_PCT) {
        // 乖離目標価格（VWAPからDEVIATION_PCT%下）に指値を置く。
        const targetPriceUsd = s.vwap20 * (1 - DEVIATION_PCT / 100);
        return { action: 'buy', budgetUsd: MAX_POSITION_USD, limitPriceUsd: targetPriceUsd, reason: `VWAPから${deviationPct.toFixed(1)}%下に乖離、平均回帰を狙って買い` };
      }
      return { action: 'skip', reason: 'VWAP乖離が閾値未満' };
    }

    if (s.dayClose >= s.vwap20) {
      return { action: 'sell', reason: 'VWAPまで回帰、利益確定' };
    }
    return { action: 'hold', reason: 'VWAP未達、保有継続' };
  },
};
