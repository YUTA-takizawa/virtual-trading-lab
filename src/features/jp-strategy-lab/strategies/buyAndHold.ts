import type { Strategy } from '../types.ts';

// 他の戦略が「いつか売る」ことを前提にしているのに対し、これだけは一度買ったら
// 二度と売らない——日本を代表する大型株（トヨタ自動車）に元本の大半を一点集中
// 投下し、あとは一切手を出さない「バイ・アンド・ホールド」。比較対象（ベンチ
// マーク）として、テクニカル指標を駆使した他の戦略が本当に「何もしない」より
// 優れているのかを測る物差しになる。
// 2026年9月、us-strategy-labの旧設定を踏襲して当初は1単元（元本の約10%）しか
// 投じておらず、残り約90%が永久に現金のままだったことが「一点集中」という
// 説明と矛盾し、ベンチマークとしても値動きが薄まってしまうというユーザー
// 指摘を受け、単位を100株に丸めながら元本の95%（5%は端数調整用の余力として
// 残す）に収まる単元数を現在値から逆算して買うように直した。
const PICK_SYMBOL = '7203.T'; // トヨタ自動車
const VIRTUAL_CAPITAL_YEN = 3_000_000; // src/features/jp-strategy-lab/index.tsと同じ値
// （decide()には元本情報が渡らないためここで直接参照する）
const TARGET_ALLOCATION_RATIO = 0.95;
const UNIT_SHARES = 100; // 1単元

export const buyAndHold: Strategy = {
  id: 'buy-and-hold',
  name: 'バイ・アンド・ホールド（トヨタ自動車一点集中）',
  description: 'トヨタ自動車(7203.T)に元本の約95%を一点集中投下し、一度買ったら二度と売らない。他の戦略群が「何もしない」より本当に優れているかを測るベンチマーク',
  decide(position, snapshot) {
    if (snapshot.symbol !== PICK_SYMBOL) {
      return { action: 'skip', reason: `この戦略は${PICK_SYMBOL}のみを対象とする` };
    }
    const hasPosition = (position?.lots.length ?? 0) > 0;
    if (!hasPosition) {
      const targetBudgetYen = VIRTUAL_CAPITAL_YEN * TARGET_ALLOCATION_RATIO;
      const units = Math.max(1, Math.floor(targetBudgetYen / (snapshot.dayClose * UNIT_SHARES)));
      const quantity = units * UNIT_SHARES;
      return { action: 'buy', quantity, reason: `${PICK_SYMBOL}に元本の約${Math.round(TARGET_ALLOCATION_RATIO * 100)}%（${units}単元）を一点集中投下、以後は二度と売らない` };
    }
    return { action: 'hold', reason: '一度買ったら売らない方針のため、価格に関わらず保有継続' };
  },
};
