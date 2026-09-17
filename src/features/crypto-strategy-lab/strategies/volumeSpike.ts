import type { Strategy } from '../types.ts';

// 出来高の急増そのものを「何か材料が出た」シグナルとみなし、値動きの方向に
// 順張りする戦略。値動き%の大きさそのものより、平時と比べた出来高の異常さ
// を主指標にする点が他の戦略と異なる。手仕舞いは75日移動平均割れの単純
// トレンドフィルタのみ。
const MAX_POSITION_YEN = 100_000;
const VOLUME_SPIKE_RATIO = 3;

export const volumeSpike: Strategy = {
  id: 'volume-spike',
  name: '出来高スパイク検知',
  description: '出来高が平時の3倍以上に急増し、かつ当日が陽線なら順張り買い。75日移動平均を割ったら手仕舞い',
  decide(position, s) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;

    if (!hasPosition) {
      if (s.volumeRatio >= VOLUME_SPIKE_RATIO && s.dailyMovePct > 0) {
        return { action: 'buy', budgetJpy: MAX_POSITION_YEN, reason: `出来高が平時の${s.volumeRatio.toFixed(1)}倍に急増、上昇方向への材料と判断し順張り買い` };
      }
      return { action: 'skip', reason: '出来高急増なし' };
    }

    if (s.dayClose < s.sma75) {
      return { action: 'sell', reason: '75日移動平均を割り込み、手仕舞い' };
    }
    return { action: 'hold', reason: 'トレンド継続中' };
  },
};
