import type { Strategy } from '../types.ts';

const MAX_POSITION_USD = 1_000;
const PROXIMITY_PCT = 0.5;

function roundStep(price: number): number {
  const magnitude = Math.floor(Math.log10(price));
  return 10 ** (magnitude - 1);
}

export const roundNumber: Strategy = {
  id: 'round-number',
  name: '心理的節目（ラウンドナンバー）反発',
  description: '価格の桁数に応じたキリのいい価格帯の直上（支持線）にいたら買い、次の節目（抵抗線）に近づいたら利確',
  decide(position, s) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;
    const step = roundStep(s.dayClose);
    const levelBelow = Math.floor(s.dayClose / step) * step;
    const levelAbove = levelBelow + step;
    const distanceAbovePct = ((s.dayClose - levelBelow) / levelBelow) * 100;
    const distanceToNextPct = ((levelAbove - s.dayClose) / s.dayClose) * 100;

    if (!hasPosition) {
      if (distanceAbovePct <= PROXIMITY_PCT && s.dayClose > s.sma75) {
        // 節目（支持線）そのものに指値を置く。
        return { action: 'buy', budgetUsd: MAX_POSITION_USD, limitPriceUsd: levelBelow, reason: `節目（$${levelBelow.toLocaleString('en-US')}）付近での支持を確認、買い` };
      }
      return { action: 'skip', reason: '節目付近ではない' };
    }

    if (distanceToNextPct <= PROXIMITY_PCT) {
      return { action: 'sell', reason: `次の節目（$${levelAbove.toLocaleString('en-US')}）に接近、抵抗を警戒し利確` };
    }
    return { action: 'hold', reason: '節目間、保有継続' };
  },
};
