import type { Strategy } from '../types.ts';

// パラボリック（加速度的な急変動）の消耗・反転を狙う戦略。逆張り
// （contrarian.ts、前日比3%程度の"普通の"下落で反応）よりずっと極端な
// 条件——25日平均から15%以上下に乖離し、かつRSIが20を切るような、
// めったに起きないパニック的投げ売り（カピチュレーション）だけに反応する。
// そうした極端な下落の直後は自律反発（デッドキャットバウンス）が起きやすい
// という経験則に賭け、反発が出たら深追いせず早めに利確する短期トレード。
const MAX_POSITION_YEN = 100_000;
const CAPITULATION_DEVIATION_PCT = 15; // 25日移動平均からこの%以上下に乖離
const CAPITULATION_RSI_MAX = 20;
const BOUNCE_TAKE_PROFIT_PCT = 10;
const RSI_EXHAUSTION_MIN = 70;

export const parabolicReversal: Strategy = {
  id: 'parabolic-reversal',
  name: 'パラボリック消耗反転',
  description: '25日移動平均から15%以上下に乖離＋RSI20未満という極端なパニック売り（カピチュレーション）だけに反応して買い、+10%の反発かRSI70超で早めに利確',
  decide(position, s) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;
    const deviationPct = ((s.dayClose - s.sma25) / s.sma25) * 100;

    if (!hasPosition) {
      if (deviationPct <= -CAPITULATION_DEVIATION_PCT && s.rsi14 < CAPITULATION_RSI_MAX) {
        return { action: 'buy', budgetJpy: MAX_POSITION_YEN, reason: `25日移動平均比${deviationPct.toFixed(0)}%・RSI${s.rsi14.toFixed(0)}のパニック的投げ売りを検知、反発狙いで買い` };
      }
      return { action: 'skip', reason: 'カピチュレーション条件未達' };
    }

    const avgEntry = position!.lots.reduce((sum, l) => sum + l.quantity * l.entryPriceJpy, 0) / position!.lots.reduce((sum, l) => sum + l.quantity, 0);
    const bouncePct = ((s.dayClose - avgEntry) / avgEntry) * 100;
    if (bouncePct >= BOUNCE_TAKE_PROFIT_PCT || s.rsi14 > RSI_EXHAUSTION_MIN) {
      return { action: 'sell', reason: `反発+${bouncePct.toFixed(0)}%またはRSI過熱、深追いせず早期利確` };
    }
    return { action: 'hold', reason: '反発待ち' };
  },
};
