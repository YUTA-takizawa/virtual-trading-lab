import type { Strategy } from '../types.ts';

// テクニカル指標も価格パターンも一切見ない、純粋な乱数による売買——「とんで
// もない買い方でもなんでもいい」というユーザー要望を文字通り実現した究極形。
// 他の29戦略が本当にサイコロを振るより優れているかを測る対照群（ベンチ
// マーク）として意図的に用意している。1回のチェックあたり未保有なら5%の
// 確率で買い、保有中なら5%の確率で売る（期待保有日数は約20営業日）。
// テストではMath.randomをモックして両分岐を検証する（他の29戦略と違い、
// この戦略だけは実行結果が再現不能であることが仕様——真のランダム性が
// 目的のため、日付や銘柄をシードにした疑似乱数化はあえて行わない）。
const MAX_POSITION_USD = 1_000;
const BUY_PROBABILITY = 0.05;
const SELL_PROBABILITY = 0.05;

export const randomWalk: Strategy = {
  id: 'random-walk',
  name: 'ランダムウォーク（ベンチマーク）',
  description: 'テクニカル指標を一切見ず、未保有なら5%の確率で買い、保有中なら5%の確率で売る純粋なコイントス。他の29戦略が「運」に勝てているかを測る対照群',
  decide(position) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;

    if (!hasPosition) {
      if (Math.random() < BUY_PROBABILITY) {
        return { action: 'buy', budgetUsd: MAX_POSITION_USD, reason: 'コイントスの結果、買い' };
      }
      return { action: 'skip', reason: 'コイントスの結果、見送り' };
    }

    if (Math.random() < SELL_PROBABILITY) {
      return { action: 'sell', reason: 'コイントスの結果、売り' };
    }
    return { action: 'hold', reason: 'コイントスの結果、保有継続' };
  },
};
