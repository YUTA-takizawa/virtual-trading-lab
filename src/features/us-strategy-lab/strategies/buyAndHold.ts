import type { Strategy } from '../types.ts';

// 他の29戦略すべてが「いつか売る」ことを前提にしているのに対し、これだけは
// 一度買ったら二度と売らない——AIブームを牽引する象徴的な1銘柄（NVDA）に
// 元本を一点集中投下し、あとは一切手を出さない「バイ・アンド・ホールド」の
// 極端な形。比較対象（ベンチマーク）として、テクニカル指標を駆使した他の
// 戦略群が本当に「何もしない」より優れているのかを測る物差しになる。
// 2026年9月、当初$1,000（元本の10%）しか投じず残り90%が永久に現金のまま
// だったことが「一点集中」という説明と矛盾し、ベンチマークとしても値動きが
// 薄まってしまうというユーザー指摘を受け、元本の95%（$500は端数調整用の
// 余力として残す）に引き上げた。
const MAX_POSITION_USD = 9_500;
const PICK_SYMBOL = 'NVDA';

export const buyAndHold: Strategy = {
  id: 'buy-and-hold',
  name: 'バイ・アンド・ホールド（NVDA一点集中）',
  description: 'NVDAだけに元本を一点集中投下し、一度買ったら二度と売らない。他の戦略群が「何もしない」より本当に優れているかを測るベンチマーク',
  decide(position, s) {
    if (s.symbol !== PICK_SYMBOL) {
      return { action: 'skip', reason: `この戦略は${PICK_SYMBOL}のみを対象とする` };
    }
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;
    if (!hasPosition) {
      return { action: 'buy', budgetUsd: MAX_POSITION_USD, reason: `${PICK_SYMBOL}に一点集中投下、以後は二度と売らない` };
    }
    return { action: 'hold', reason: '一度買ったら売らない方針のため、価格に関わらず保有継続' };
  },
};
