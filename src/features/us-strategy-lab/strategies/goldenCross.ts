import type { Strategy } from '../types.ts';

// 米国株の代表的な長期シグナルとして特に有名な「ゴールデンクロス/デッド
// クロス」（50日線と200日線）。移動平均クロス（maCross.ts、25日/75日）
// より遥かに長い時間軸で判断する、より腰の据わったスイングトレード——
// 6か月のヒストリーだけでは計算できなかったため、この戦略のために
// fetchDailyHistoryの取得期間を1年に延長した（2026年9月1日）。
const MAX_POSITION_USD = 1_000;

export const goldenCross: Strategy = {
  id: 'golden-cross',
  name: 'ゴールデンクロス/デッドクロス（50日/200日）',
  description: '50日移動平均が200日移動平均を上抜けたら買い（ゴールデンクロス）、下抜けたら売り（デッドクロス）。米国株で最も広く語られる長期トレンド転換シグナル',
  decide(position, s) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;
    const goldenCrossed = s.prevSma50 <= s.prevSma200 && s.sma50 > s.sma200;
    const deadCrossed = s.prevSma50 >= s.prevSma200 && s.sma50 < s.sma200;

    if (!hasPosition) {
      if (goldenCrossed) {
        return { action: 'buy', budgetUsd: MAX_POSITION_USD, reason: 'ゴールデンクロス（50日線が200日線を上抜け）を検知、長期トレンド転換とみなし買い' };
      }
      return { action: 'skip', reason: 'ゴールデンクロス未発生' };
    }

    if (deadCrossed) {
      return { action: 'sell', reason: 'デッドクロス（50日線が200日線を下抜け）を検知、長期トレンド終了とみなし手仕舞い' };
    }
    return { action: 'hold', reason: 'クロス未発生、長期トレンド継続中とみなし保有継続' };
  },
};
