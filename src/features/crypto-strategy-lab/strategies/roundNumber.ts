import type { Strategy } from '../types.ts';

// 心理的節目（ラウンドナンバー）での反発を狙う戦略。「キリのいい価格」は
// 多くの参加者が指値注文を置きやすく、実際に支持線・抵抗線として機能
// しやすいとされる市場心理に基づく手法——他の戦略のようなテクニカル指標
// ではなく、価格の"桁"だけを見る点がユニーク。BTCなら100万円単位、DOGEの
// ような低価格帯の銘柄なら1円単位、というように価格の大きさに応じて
// キリのいい間隔を動的に決める。
const MAX_POSITION_YEN = 100_000;
const PROXIMITY_PCT = 0.5; // 節目からこの%以内にいたら「節目付近」とみなす

// 価格の大きさに応じたキリのいい間隔を決める（例: 12,000,000円台なら
// 1,000,000円刻み、13円台なら1円刻み）。
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
        return { action: 'buy', budgetJpy: MAX_POSITION_YEN, reason: `節目（${Math.round(levelBelow).toLocaleString('ja-JP')}円）付近での支持を確認、買い` };
      }
      return { action: 'skip', reason: '節目付近ではない' };
    }

    if (distanceToNextPct <= PROXIMITY_PCT) {
      return { action: 'sell', reason: `次の節目（${Math.round(levelAbove).toLocaleString('ja-JP')}円）に接近、抵抗を警戒し利確` };
    }
    return { action: 'hold', reason: '節目間、保有継続' };
  },
};
