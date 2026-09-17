import type { Strategy } from '../types.ts';

// 3本の移動平均線の並び順（パーフェクトオーダー）で相場の地合いを判定する
// 順張り戦略。短期(10日)＞中期(25日)＞長期(75日)ときれいに並んでいる状態は
// 「強いトレンドが確立している」ことの目安とされる。移動平均クロス
// （maCross.ts）が2本の交差の"瞬間"を捉えるのに対し、こちらは3本の
// "並び順"という状態を見る点が異なる——一度並び順が崩れるまでは買い増し
// せず持ち続ける、より長期スタンスの手法。
const MAX_POSITION_YEN = 100_000;

export const perfectOrder: Strategy = {
  id: 'perfect-order',
  name: '3本移動平均パーフェクトオーダー',
  description: '短期(10日)＞中期(25日)＞長期(75日)の順に並ぶ「パーフェクトオーダー」が新規に成立したら買い、並び順が崩れたら手仕舞い',
  decide(position, s) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;
    const isPerfectOrder = s.sma10 > s.sma25 && s.sma25 > s.sma75;
    const wasPerfectOrder = s.prevSma10 > s.prevSma25 && s.prevSma25 > s.prevSma75;

    if (!hasPosition) {
      if (isPerfectOrder && !wasPerfectOrder) {
        return { action: 'buy', budgetJpy: MAX_POSITION_YEN, reason: '短期>中期>長期のパーフェクトオーダーが新規成立、強いトレンドとみなし買い' };
      }
      return { action: 'skip', reason: 'パーフェクトオーダー未成立' };
    }

    if (!isPerfectOrder) {
      return { action: 'sell', reason: '移動平均の並び順が崩れ、トレンド終了とみなし手仕舞い' };
    }
    return { action: 'hold', reason: 'パーフェクトオーダー継続中' };
  },
};
