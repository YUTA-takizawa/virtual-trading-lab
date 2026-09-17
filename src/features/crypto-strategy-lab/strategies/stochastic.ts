import type { Strategy } from '../types.ts';

// ストキャスティクス（%K14・%D3）。RSI単体逆張り（rsiOnly.ts）と似た
// オシレーター系の逆張りだが、計算方法が異なる（RSIは値幅の変化率、
// ストキャスティクスは直近レンジ内での位置）。売られすぎ圏（20以下）で
// %Kが%Dを上抜けたら買い、買われすぎ圏（80以上）で%Kが%Dを下抜けたら売り
// ——単純な閾値越えではなく「ゾーン内でのクロス」を見る点がRSI単体版との違い。
const MAX_POSITION_YEN = 100_000;
const OVERSOLD = 20;
const OVERBOUGHT = 80;

export const stochastic: Strategy = {
  id: 'stochastic',
  name: 'ストキャスティクス',
  description: '売られすぎ圏（20以下）で%Kが%Dを上抜けたら買い、買われすぎ圏（80以上）で%Kが%Dを下抜けたら売り',
  decide(position, s) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;

    if (!hasPosition) {
      if (s.stochK <= OVERSOLD && s.stochK > s.stochD) {
        return { action: 'buy', budgetJpy: MAX_POSITION_YEN, reason: `売られすぎ圏（%K=${s.stochK.toFixed(0)}）で%Kが%Dを上抜け、買いシグナル` };
      }
      return { action: 'skip', reason: '売られすぎ圏での上抜け未発生' };
    }

    if (s.stochK >= OVERBOUGHT && s.stochK < s.stochD) {
      return { action: 'sell', reason: `買われすぎ圏（%K=${s.stochK.toFixed(0)}）で%Kが%Dを下抜け、売りシグナル` };
    }
    return { action: 'hold', reason: '買われすぎ圏での下抜け未発生' };
  },
};
