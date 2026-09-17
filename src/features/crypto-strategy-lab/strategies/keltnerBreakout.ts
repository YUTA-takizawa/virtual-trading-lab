import type { Strategy } from '../types.ts';

// ケルトナーチャネル・ブレイクアウト。ボリンジャーバンド逆張り
// （bollinger.ts）が「バンドに触れたら反発を狙う」平均回帰なのに対し、
// こちらは「バンドを上に抜けたらトレンド継続とみなして追随する」順張り
// ブレイクアウト——同じ「バンド」の発想でも売買方向が逆になる好対照。
// バンド幅は標準偏差（統計的なばらつき）ではなくATR（実際の値動きの荒さ）
// で決める点もボリンジャーバンドとの違い。中心線は本来EMAだが、他の戦略
// との一貫性のため25日SMAで代用する簡易版（意図的な簡略化）。
const MAX_POSITION_YEN = 100_000;
const ATR_MULTIPLIER = 2;

export const keltnerBreakout: Strategy = {
  id: 'keltner-breakout',
  name: 'ケルトナーチャネル・ブレイクアウト',
  description: '25日移動平均±ATR14×2のチャネル上限を上抜けたら買い（順張り）、中心線を割ったら手仕舞い',
  decide(position, s) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;
    const upperBand = s.sma25 + s.atr14 * ATR_MULTIPLIER;

    if (!hasPosition) {
      if (s.dayClose > upperBand) {
        return { action: 'buy', budgetJpy: MAX_POSITION_YEN, reason: `ケルトナーチャネル上限（25日移動平均+ATR×${ATR_MULTIPLIER}）を上抜け、順張り買い` };
      }
      return { action: 'skip', reason: 'チャネル上限未到達' };
    }

    if (s.dayClose < s.sma25) {
      return { action: 'sell', reason: '中心線（25日移動平均）を割り込み、手仕舞い' };
    }
    return { action: 'hold', reason: 'チャネル内、保有継続' };
  },
};
