import type { Strategy } from '../types.ts';

// daytrade-sim-crypto/rules.tsの逆張り戦略を、この実験場の汎用ポートフォリオ
// （trancheNumberなし、budgetJpyで買い増し）向けに再実装したもの。段階は
// position.lots.lengthで代用する（0件=打診買い、1件=追撃買い、2件=本買い）。
const MAX_POSITION_YEN = 100_000;
const BUDGET_STAGE = [1 / 9, 2 / 9, 6 / 9]; // 打診・追撃・本買いの配分比率（1:2:6と同じ考え方）
const CRASH_PCT = 3;
const SURGE_PCT = 3;
const RSI_BUY_MAX = 60;
const RSI_SELL_MIN = 55;
const VOLUME_RATIO_MIN = 1.2;
const TREND_BREAK_BUFFER_PCT = 3;

export const contrarian: Strategy = {
  id: 'contrarian',
  name: '逆張り（コントラリアン）',
  description: '前日比急落＋RSI・出来高の裏付け＋75日トレンド内で打診買い、急騰＋RSI過熱で利確。daytrade-sim-cryptoと同じ設計',
  decide(position, s) {
    const stage = position?.lots.length ?? 0;
    const hasPosition = Boolean(position) && stage > 0;

    if (!hasPosition) {
      if (s.dailyMovePct <= -CRASH_PCT) {
        const trendOk = s.dayClose > s.sma75;
        const rsiOk = s.rsi14 < RSI_BUY_MAX;
        const volOk = s.volumeRatio >= VOLUME_RATIO_MIN;
        if (trendOk && rsiOk && volOk) {
          return { action: 'buy', budgetJpy: MAX_POSITION_YEN * BUDGET_STAGE[0]!, reason: `前日比急落（${s.dailyMovePct.toFixed(1)}%）＋RSI・出来高裏付けあり（打診買い）` };
        }
      }
      return { action: 'skip', reason: '急落条件を満たさず見送り' };
    }

    // 保有中
    const trendBreakLine = s.sma75 * (1 - TREND_BREAK_BUFFER_PCT / 100);
    if (s.dayClose < trendBreakLine) {
      return { action: 'sell', reason: `75日移動平均を${TREND_BREAK_BUFFER_PCT}%超下回りトレンド割れ（手仕舞い）` };
    }
    if (s.dailyMovePct >= SURGE_PCT && s.rsi14 >= RSI_SELL_MIN) {
      return { action: 'sell', reason: `前日比急騰（${s.dailyMovePct.toFixed(1)}%）＋RSI過熱で利確` };
    }
    if (stage < 3 && s.dailyMovePct > 0) {
      return { action: 'buy', budgetJpy: MAX_POSITION_YEN * BUDGET_STAGE[stage]!, reason: `含み益が乗り追撃買い（${stage + 1}段階目）` };
    }
    return { action: 'hold', reason: 'シグナルなし' };
  },
};
