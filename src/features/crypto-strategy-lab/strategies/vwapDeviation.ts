import type { Strategy } from '../types.ts';

// 20日出来高加重平均線（VWAP）からの乖離を見る平均回帰戦略。単純移動平均
// （ボリンジャーバンドの中心線など）と違い、出来高の大きかった日の価格を
// 重視するため「多くの人が実際に売買した価格帯」からの乖離とみなせる。
const MAX_POSITION_YEN = 100_000;
const DEVIATION_PCT = 5; // VWAPからこの%以上下に乖離したら買い

export const vwapDeviation: Strategy = {
  id: 'vwap-deviation',
  name: 'VWAP乖離',
  description: '20日出来高加重平均線（VWAP）から5%以上下に乖離したら買い、VWAPまで戻ったら利確',
  decide(position, s) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;
    const deviationPct = ((s.dayClose - s.vwap20) / s.vwap20) * 100;

    if (!hasPosition) {
      if (deviationPct <= -DEVIATION_PCT) {
        return { action: 'buy', budgetJpy: MAX_POSITION_YEN, reason: `VWAPから${deviationPct.toFixed(1)}%下に乖離、平均回帰を狙って買い` };
      }
      return { action: 'skip', reason: 'VWAP乖離が閾値未満' };
    }

    if (s.dayClose >= s.vwap20) {
      return { action: 'sell', reason: 'VWAPまで回帰、利益確定' };
    }
    return { action: 'hold', reason: 'VWAP未達、保有継続' };
  },
};
