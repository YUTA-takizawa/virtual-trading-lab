import type { Strategy } from '../types.ts';

// 意図的に単純化した「RSIだけを見る」逆張り戦略。値動き%・出来高・トレンド
// フィルタは一切見ない。他の凝った戦略との比較対象となる、素朴なベース
// ラインとして用意している。
const MAX_POSITION_YEN = 100_000;
const RSI_BUY_MAX = 30;
const RSI_SELL_MIN = 70;

export const rsiOnly: Strategy = {
  id: 'rsi-only',
  name: 'RSI単体逆張り',
  description: 'RSI14が30未満で買い、70超で売り。値動き%・出来高・トレンドは一切見ない素朴な比較用ベースライン',
  decide(position, s) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;

    if (!hasPosition) {
      if (s.rsi14 < RSI_BUY_MAX) {
        return { action: 'buy', budgetJpy: MAX_POSITION_YEN, reason: `RSI14が${s.rsi14.toFixed(0)}まで低下、売られすぎと判断し買い` };
      }
      return { action: 'skip', reason: 'RSI未達' };
    }

    if (s.rsi14 > RSI_SELL_MIN) {
      return { action: 'sell', reason: `RSI14が${s.rsi14.toFixed(0)}まで上昇、買われすぎと判断し利確` };
    }
    return { action: 'hold', reason: 'RSI中立、保有継続' };
  },
};
