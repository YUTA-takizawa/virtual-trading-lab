import type { Strategy } from '../types.ts';

// ユーザー要望「スイングトレード戦略・完全まとめ（汎用版）」（2026年9月4日）
// をそのままシミュレーション化した戦略。ユーザーの説明は資金管理
// （¥500,000×6枠）と決済ルール（±¥20,000の固定円ブラケット、IFD-OCO/OCO
// 注文の説明）は明確だったが、「そもそもどのタイミングで新規に買うか」は
// 未指定だったため、確認の上でdaytrade-sim本体のルール1（朝の急落は買い）
// と同じ「前日比急落＋RSI・出来高の裏付け＋75日トレンド内」という条件を
// エントリーシグナルとして流用することにした（同じ「押し目を待つ」逆張り
// 哲学と相性がいいと判断）。決済だけがdaytrade-sim本体と違い、%ベースの
// 利確/損切りではなく固定円ブラケット。
//
// 候補銘柄はconfig/daytrade.jsonをそのまま流用（別途configは持たない）。
// 「1単元（100株）が20万〜50万円前後」という指定は、実行のたびに現在値で
// 動的に判定する（daytrade-sim/index.tsの--profile=cheapと同じ考え方）。
const MAX_SLOTS = 6; // ¥3,000,000 ÷ ¥500,000
const SLOT_BUDGET_YEN = 500_000;
const UNIT_SHARES = 100; // 1単元
const MIN_UNIT_COST_YEN = 200_000;
const MAX_UNIT_COST_YEN = 500_000;
const TAKE_PROFIT_YEN = 20_000;
const STOP_LOSS_YEN = 20_000;
const CRASH_PCT = 3;
const RSI_BUY_MAX = 60;
const VOLUME_RATIO_MIN = 1.2;

export const swingBracket: Strategy = {
  id: 'swing-bracket',
  name: 'スイングブラケット（固定¥20,000利確/損切り）',
  description: '¥3,000,000を¥500,000×6枠に分散。1単元(100株)¥200,000〜¥500,000の値動きが穏やかな大型株を対象に、前日比急落＋RSI・出来高裏付け＋75日トレンド内で1単元だけ買い、含み損益が±¥20,000に達したら理由を問わず機械的に手仕舞う（リスクリワード1:1、勝率51%あれば理論上資産が増える設計）',
  decide(position, s, _allSnapshots, openPositionCount) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;

    if (!hasPosition) {
      if (openPositionCount >= MAX_SLOTS) {
        return { action: 'skip', reason: `保有枠上限（${MAX_SLOTS}枠）に達しているため新規建て見送り` };
      }
      const unitCostYen = s.dayClose * UNIT_SHARES;
      if (unitCostYen < MIN_UNIT_COST_YEN || unitCostYen > MAX_UNIT_COST_YEN) {
        return { action: 'skip', reason: `1単元の取得コスト（¥${Math.round(unitCostYen).toLocaleString('ja-JP')}）が対象レンジ（¥${MIN_UNIT_COST_YEN.toLocaleString('ja-JP')}〜¥${MAX_UNIT_COST_YEN.toLocaleString('ja-JP')}）外` };
      }
      const trendOk = s.dayClose > s.sma75;
      const rsiOk = s.rsi14 < RSI_BUY_MAX;
      const volumeOk = s.volumeRatio >= VOLUME_RATIO_MIN;
      if (s.dailyMovePct <= -CRASH_PCT && trendOk && rsiOk && volumeOk) {
        // 急落を確認したその価格に指値を置く（成行で翌営業日始値を無条件に追いかけない）。
        return { action: 'buy', quantity: UNIT_SHARES, limitPriceJpy: s.dayClose, reason: `前日比急落（${s.dailyMovePct.toFixed(1)}%）＋RSI・出来高裏付けあり、1単元（${UNIT_SHARES}株）買い` };
      }
      return { action: 'skip', reason: '急落条件を満たさず見送り' };
    }

    const avgEntry = position!.lots.reduce((sum, l) => sum + l.quantity * l.entryPriceJpy, 0) / position!.lots.reduce((sum, l) => sum + l.quantity, 0);
    const quantity = position!.lots.reduce((sum, l) => sum + l.quantity, 0);
    const unrealizedPnlYen = (s.dayClose - avgEntry) * quantity;

    if (unrealizedPnlYen >= TAKE_PROFIT_YEN) {
      return { action: 'sell', reason: `含み益が+¥${Math.round(unrealizedPnlYen).toLocaleString('ja-JP')}に到達、利益確定（+¥${TAKE_PROFIT_YEN.toLocaleString('ja-JP')}ブラケット）` };
    }
    if (unrealizedPnlYen <= -STOP_LOSS_YEN) {
      return { action: 'sell', reason: `含み損が-¥${Math.round(Math.abs(unrealizedPnlYen)).toLocaleString('ja-JP')}に到達、機械的に損切り（-¥${STOP_LOSS_YEN.toLocaleString('ja-JP')}ブラケット、絶対に妥協しない）` };
    }
    return { action: 'hold', reason: `含み損益 ¥${Math.round(unrealizedPnlYen).toLocaleString('ja-JP')}、ブラケット未到達` };
  },
};
