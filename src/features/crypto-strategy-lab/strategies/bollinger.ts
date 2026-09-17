import type { Strategy } from '../types.ts';

// ボリンジャーバンド（20日SMA±2σ）を使った平均回帰（逆張り）戦略。下限
// バンドタッチは統計的な売られすぎとみなして買い、中央線（20日SMA）まで
// 戻ったら利確する。急落系のcontrarian戦略と違い、値動き%やRSIは見ない
// —— バンド幅そのもの（統計的な位置）だけで判断する点が異なる。
const MAX_POSITION_YEN = 100_000;

export const bollinger: Strategy = {
  id: 'bollinger',
  name: 'ボリンジャーバンド逆張り',
  description: '20日移動平均±2σの下限バンドを割ったら買い、中央線（20日SMA）まで戻ったら利確',
  decide(position, s) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;

    if (!hasPosition) {
      if (s.dayClose <= s.bollingerLower) {
        return { action: 'buy', budgetJpy: MAX_POSITION_YEN, reason: `ボリンジャーバンド下限（${Math.round(s.bollingerLower)}円）を割り込み、統計的な売られすぎと判断し買い` };
      }
      return { action: 'skip', reason: '下限バンド未達' };
    }

    if (s.dayClose >= s.bollingerMid) {
      return { action: 'sell', reason: '中央線（20日移動平均）まで回帰、利益確定' };
    }
    return { action: 'hold', reason: '中央線未達、保有継続' };
  },
};
