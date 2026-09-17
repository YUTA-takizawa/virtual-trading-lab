import type { Strategy } from '../types.ts';

// 「52週高値」（実際にはデータ取得期間の制約で約200営業日＝約1年弱の高値）
// を更新するほどの強さを見せた銘柄はしばらく強いまま、という考え方の
// タートル流ブレイクアウト。20日高値ブレイクアウト（breakout.ts）よりも
// 遥かに長い時間軸で「新値」を判定する点が異なる——短期の20日高値は頻繁に
// 更新されるが、200日高値の更新はずっと稀で、それだけ強いシグナルとされる。
// 手仕舞いは20日安値割れ（breakout.tsと同じトレーリングストップ）。
const MAX_POSITION_USD = 1_000;
const VOLUME_RATIO_MIN = 1.3;

export const longTermBreakout: Strategy = {
  id: 'long-term-breakout',
  name: '長期高値ブレイクアウト（約200日高値）',
  description: '約200営業日（およそ1年）ぶりの高値を出来高付きで更新したら買い、20日安値を割ったら手仕舞い。タートルトレード流の「強さを買う」順張り',
  decide(position, s) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;

    if (!hasPosition) {
      if (s.dayClose >= s.highestHigh200 && s.volumeRatio >= VOLUME_RATIO_MIN) {
        return { action: 'buy', budgetUsd: MAX_POSITION_USD, reason: `約200日ぶりの高値更新（出来高${s.volumeRatio.toFixed(1)}倍で裏付け）を確認、長期ブレイクアウト買い` };
      }
      return { action: 'skip', reason: '長期高値更新なし' };
    }

    if (s.dayClose <= s.lowestLow20) {
      return { action: 'sell', reason: '20日安値を割り込み、トレーリングストップとして手仕舞い' };
    }
    return { action: 'hold', reason: '安値割れなし、保有継続' };
  },
};
