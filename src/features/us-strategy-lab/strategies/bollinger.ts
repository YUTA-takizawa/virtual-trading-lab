import type { Strategy } from '../types.ts';

const MAX_POSITION_USD = 1_000;

export const bollinger: Strategy = {
  id: 'bollinger',
  name: 'ボリンジャーバンド逆張り',
  description: '20日移動平均±2σの下限バンドを割ったら買い、中央線（20日SMA）まで戻ったら利確',
  decide(position, s) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;

    if (!hasPosition) {
      if (s.dayClose <= s.bollingerLower) {
        // 下限バンドの水準そのものに指値を置く（成行で当日終値を追いかけない）。
        return { action: 'buy', budgetUsd: MAX_POSITION_USD, limitPriceUsd: s.bollingerLower, reason: `ボリンジャーバンド下限（$${s.bollingerLower.toFixed(2)}）を割り込み、統計的な売られすぎと判断し買い` };
      }
      return { action: 'skip', reason: '下限バンド未達' };
    }

    if (s.dayClose >= s.bollingerMid) {
      return { action: 'sell', reason: '中央線（20日移動平均）まで回帰、利益確定' };
    }
    return { action: 'hold', reason: '中央線未達、保有継続' };
  },
};
