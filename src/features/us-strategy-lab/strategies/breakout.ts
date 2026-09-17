import type { Strategy } from '../types.ts';

const MAX_POSITION_USD = 1_000;
const VOLUME_RATIO_MIN = 1.5;

export const breakout: Strategy = {
  id: 'breakout',
  name: 'ブレイクアウト（20日高値/安値）',
  description: '直近20日の高値を出来高付きで更新したら買い、20日安値を割ったら手仕舞い',
  decide(position, s) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;

    if (!hasPosition) {
      if (s.dayClose >= s.highestHigh20 && s.volumeRatio >= VOLUME_RATIO_MIN) {
        return { action: 'buy', budgetUsd: MAX_POSITION_USD, reason: `20日高値更新（出来高${s.volumeRatio.toFixed(1)}倍で裏付け）を確認、ブレイクアウト買い` };
      }
      return { action: 'skip', reason: '高値更新なし' };
    }

    if (s.dayClose <= s.lowestLow20) {
      return { action: 'sell', reason: '20日安値を割り込み、トレーリングストップとして手仕舞い' };
    }
    return { action: 'hold', reason: '安値割れなし、保有継続' };
  },
};
