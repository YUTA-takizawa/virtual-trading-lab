import type { Strategy } from '../types.ts';

// RSIダイバージェンス（逆行現象）戦略。RSI単体逆張り（rsiOnly.ts）が
// RSIの絶対水準だけを見るのに対し、こちらは「価格とRSIの動きが逆行して
// いるか」を見る、より高度なパターン認識。price↓・RSI↑（弱気の売り圧力が
// 弱まっている強気ダイバージェンス）で買い、保有中はprice↑・RSI↓（買い
// 圧力が続かない弱気ダイバージェンス）で手仕舞う。
const MAX_POSITION_YEN = 100_000;

export const rsiDivergence: Strategy = {
  id: 'rsi-divergence',
  name: 'RSIダイバージェンス',
  description: '価格は10日前より下落しているのにRSIは上昇している強気ダイバージェンスで買い、逆（価格上昇・RSI下落）の弱気ダイバージェンスで手仕舞う',
  decide(position, s) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;
    const priceDown = s.dayClose < s.closePrior;
    const rsiUp = s.rsi14 > s.rsi14Prior;
    const priceUp = s.dayClose > s.closePrior;
    const rsiDown = s.rsi14 < s.rsi14Prior;

    if (!hasPosition) {
      if (priceDown && rsiUp) {
        return { action: 'buy', budgetJpy: MAX_POSITION_YEN, reason: '価格は下落もRSIは上昇（強気ダイバージェンス）、売り圧力の弱まりを検知し買い' };
      }
      return { action: 'skip', reason: '強気ダイバージェンス未検知' };
    }

    if (priceUp && rsiDown) {
      return { action: 'sell', reason: '価格は上昇もRSIは下落（弱気ダイバージェンス）、買い圧力の陰りを検知し手仕舞い' };
    }
    return { action: 'hold', reason: '弱気ダイバージェンス未検知' };
  },
};
