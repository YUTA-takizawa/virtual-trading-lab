import type { Strategy } from '../types.ts';

// 他の22戦略すべてが「いつか売る」ことを前提にしているのに対し、これだけは
// 一度買ったら二度と売らない——時価総額最大の代表銘柄（BTC）に元本の一部を
// 一点集中投下し、あとは一切手を出さない「バイ・アンド・ホールド」の極端な形。
// 比較対象（ベンチマーク）として、テクニカル指標を駆使した他の戦略群が
// 本当に「何もしない」より優れているのかを測る物差しになる。
// 2026年9月、ユーザー要望で「最大ドローダウン」「勝率」と並ぶ比較軸として、
// us-strategy-labの同名戦略と同じ設計思想でJP/crypto両ラボにも追加
// （3か月の新規取引方法ストップの明示的な例外として承認済み）。
// 当初は元本の10%（us-strategy-labの旧設定を踏襲）しか投じておらず、残り
// 90%が永久に現金のままだったことが「一点集中」という説明と矛盾し、
// ベンチマークとしても値動きが薄まってしまうというユーザー指摘を受け、
// 元本の95%（5%は端数調整用の余力として残す）に引き上げた。
const MAX_POSITION_YEN = 950_000;
const PICK_SYMBOL = 'BTC-JPY';

export const buyAndHold: Strategy = {
  id: 'buy-and-hold',
  name: 'バイ・アンド・ホールド（BTC一点集中）',
  description: 'ビットコイン(BTC-JPY)だけに元本を一点集中投下し、一度買ったら二度と売らない。他の戦略群が「何もしない」より本当に優れているかを測るベンチマーク',
  decide(position, s) {
    if (s.symbol !== PICK_SYMBOL) {
      return { action: 'skip', reason: `この戦略は${PICK_SYMBOL}のみを対象とする` };
    }
    const hasPosition = (position?.lots.length ?? 0) > 0;
    if (!hasPosition) {
      return { action: 'buy', budgetJpy: MAX_POSITION_YEN, reason: `${PICK_SYMBOL}に一点集中投下、以後は二度と売らない` };
    }
    return { action: 'hold', reason: '一度買ったら売らない方針のため、価格に関わらず保有継続' };
  },
};
