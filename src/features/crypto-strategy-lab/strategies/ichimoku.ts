import type { Strategy } from '../types.ts';

// 一目均衡表の転換線（9日）・基準線（26日）クロス。本来の一目均衡表は
// 26日先行表示する「雲」（先行スパンA/B）も判断材料にするが、雲は未来に
// 向けて描画されるものなので当日の売買判断にそのまま使うには相性が悪く、
// 意図的に省略している（詳細はindicators.tsのcalcIchimokuTkコメント参照）。
const MAX_POSITION_YEN = 100_000;

export const ichimoku: Strategy = {
  id: 'ichimoku',
  name: '一目均衡表（転換線/基準線クロス）',
  description: '転換線（9日）が基準線（26日）を上抜けたら買い、下抜けたら売り。雲（先行スパン）は意図的に省略した簡易版',
  decide(position, s) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;
    const goldenCross = s.prevTenkanSen <= s.prevKijunSen && s.tenkanSen > s.kijunSen;
    const deadCross = s.prevTenkanSen >= s.prevKijunSen && s.tenkanSen < s.kijunSen;

    if (!hasPosition) {
      if (goldenCross) {
        return { action: 'buy', budgetJpy: MAX_POSITION_YEN, reason: '転換線が基準線を上抜け、買いシグナル' };
      }
      return { action: 'skip', reason: 'クロス未発生' };
    }

    if (deadCross) {
      return { action: 'sell', reason: '転換線が基準線を下抜け、売りシグナル' };
    }
    return { action: 'hold', reason: 'クロス未発生、保有継続' };
  },
};
