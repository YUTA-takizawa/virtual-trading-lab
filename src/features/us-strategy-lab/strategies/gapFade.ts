import type { Strategy } from '../types.ts';

// 寄り付きギャップの当日埋め（ギャップフェード）を狙う、デイトレード寄りの
// 短期反転戦略。他の戦略の多くが「前日終値→当日終値」の値動き（daily
// MovePct）を見るのに対し、こちらは「前日終値→当日始値」のギャップ
// （gapPct）そのものに反応する——寄り付き直後の過剰反応を狙う設計で、
// 日足データしか扱わないこのラボの中では最も"デイトレード"に近い時間軸。
// 大きく下にギャップした翌日以降、値幅の一部を埋め戻すことが多いという
// 経験則に賭ける。
const MAX_POSITION_USD = 1_000;
const GAP_DOWN_THRESHOLD_PCT = -3;
const GAP_FILL_TARGET_PCT = 4; // 平均取得単価からこの%戻ったら利確
const STOP_LOSS_PCT = 6; // ギャップが埋まらずさらに下がった場合の損切り

export const gapFade: Strategy = {
  id: 'gap-fade',
  name: 'ギャップフェード（寄り付きギャップ埋め）',
  description: '前日終値比3%以上の下方ギャップで寄り付いたら、値幅を埋め戻す反発を狙って買い。+4%で利確、-6%で損切り',
  decide(position, s) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;

    if (!hasPosition) {
      if (s.gapPct <= GAP_DOWN_THRESHOLD_PCT) {
        return { action: 'buy', budgetUsd: MAX_POSITION_USD, reason: `前日終値比${s.gapPct.toFixed(1)}%の下方ギャップを検知、値幅埋め戻しを狙って買い` };
      }
      return { action: 'skip', reason: '下方ギャップなし' };
    }

    const avgEntry = position!.lots.reduce((sum, l) => sum + l.quantity * l.entryPriceUsd, 0) / position!.lots.reduce((sum, l) => sum + l.quantity, 0);
    const unrealizedPct = ((s.dayClose - avgEntry) / avgEntry) * 100;
    if (unrealizedPct >= GAP_FILL_TARGET_PCT) {
      return { action: 'sell', reason: `平均取得単価比+${unrealizedPct.toFixed(1)}%、ギャップ埋め達成とみなし利確` };
    }
    if (unrealizedPct <= -STOP_LOSS_PCT) {
      return { action: 'sell', reason: `平均取得単価比${unrealizedPct.toFixed(1)}%、ギャップが埋まらず損切り` };
    }
    return { action: 'hold', reason: 'ギャップ埋め待ち' };
  },
};
