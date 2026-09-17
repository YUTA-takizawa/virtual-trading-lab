import type { DaytradeThresholds, RuleInputs, RuleSignal } from './types.ts';

// Hysteresis buffer for the trend-break exit below — not a tunable knob.
// Without it, a position hovering right at its 75-day SMA would sell the
// moment dayClose dips a hair below the line, then re-buy on the next
// morning-crash signal while still above it, then sell again on the next
// wobble: extra round-trips, each one paying TAX_RATE_ON_GAINS and adding to
// the day's calcDailyCommission tier for no real signal. Requiring the close
// to be meaningfully (not just technically) below the line filters that out.
const TREND_BREAK_BUFFER_PCT = 3;

/**
 * Encodes 「相場の8箇条」 (Fujimoto Shigeru's contrarian day/swing-trade
 * rules) plus RSI/volume confirmation, PER/PBR fundamentals filtering,
 * 1:2:6 pyramided buying, a simplified 場中決算プレイ, an optional
 * (default-off) mechanical stop-loss, a 75-day-SMA trend filter, and a
 * trend-break exit, as a deterministic decision. All *Pct fields on
 * RuleInputs and DaytradeThresholds are percentage units (e.g. -3.5 means
 * -3.5%), matching stock-alert's `changePct` convention.
 *
 * "陰線で買い・陽線で売る" (rule 5) and "もみ合いは待つ" (rule 7) are folded
 * into the crash/surge/flat checks below rather than kept as independent
 * triggers — keeping them separate would let differently-thresholded rules
 * fire in conflicting directions on the same day.
 *
 * The trend filter/break (added 2026-08-20) narrow rule 1's "朝の急落は買い"
 * to dips *within* an uptrend (dayClose above its 75-day SMA), rather than
 * any dip — buying every crash with no trend context risks catching a stock
 * in genuine structural decline. It's a separate, always-on check from
 * stopLossPct (which stays default-off, per rule 3's "パニック売りしない"):
 * small drawdowns within an intact trend are left alone, but a close
 * meaningfully below the trend line (see TREND_BREAK_BUFFER_PCT) is treated
 * as the thesis being wrong, not noise to ride out.
 *
 * A returned 'buy'/'sell' is a *decision*, not yet a fill — index.ts queues
 * it as a PendingOrder and fills it at the next session (2026-08-31: a real
 * order placed after seeing a session's close can't execute at that
 * already-printed price). tranche1 buys (the crash-probe) carry a
 * `limitPrice` and only fill if the next session's low actually reaches it
 * (2026-09-01, see RuleSignal.limitPrice); every other action fills at the
 * next session's open unconditionally. This function only decides what to
 * do, not when/whether it settles.
 */
export function decideTrade(inputs: RuleInputs, thresholds: DaytradeThresholds): RuleSignal {
  return inputs.hasPosition ? decideWhileHolding(inputs, thresholds) : decideWhileFlat(inputs, thresholds);
}

function decideWhileFlat(inputs: RuleInputs, th: DaytradeThresholds): RuleSignal {
  const morningCrash = inputs.morningMovePct <= -th.morningCrashPct;

  if (morningCrash) {
    const perOk = inputs.per === undefined || inputs.per <= th.perMax;
    const pbrOk = inputs.pbr === undefined || inputs.pbr <= th.pbrMax;
    const rsiConfirmed = inputs.rsi14 < th.rsiBuyConfirmMax || inputs.earningsAnnouncedToday;
    const volumeConfirmed = inputs.volumeRatio >= th.volumeRatioMin;
    const trendOk = inputs.dayClose > inputs.sma75;

    if (trendOk && rsiConfirmed && volumeConfirmed && perOk && pbrOk) {
      const earningsNote = inputs.earningsAnnouncedToday && inputs.rsi14 >= th.rsiBuyConfirmMax ? '本日決算発表を確認、RSI条件を免除。' : '';
      return {
        action: 'buy',
        trancheNumber: 1,
        // 急落を確認したその価格に指値を置く（成行で次セッション始値を無条件に追いかけない）。
        limitPrice: inputs.dayClose,
        reason: `朝の急落（${inputs.morningMovePct.toFixed(1)}%）を確認、${earningsNote}RSI ${inputs.rsi14.toFixed(0)}・出来高${inputs.volumeRatio.toFixed(1)}倍で裏付けあり（ルール1: 朝の急落は買い、打診買い）`,
      };
    }
    if (!trendOk) {
      return {
        action: 'skip',
        reason: `朝の急落（${inputs.morningMovePct.toFixed(1)}%）はあったが、株価が75日移動平均を下回っており下落トレンド中の可能性が高いため見送り（トレンドフィルタ）`,
      };
    }
    if (!perOk || !pbrOk) {
      return {
        action: 'skip',
        reason: `朝の急落（${inputs.morningMovePct.toFixed(1)}%）はあったが、PER ${inputs.per?.toFixed(1) ?? '不明'}・PBR ${inputs.pbr?.toFixed(2) ?? '不明'}がファンダメンタルズ基準（PER≤${th.perMax}・PBR≤${th.pbrMax}）を満たさないため見送り`,
      };
    }
    return {
      action: 'skip',
      reason: `朝の急落（${inputs.morningMovePct.toFixed(1)}%）はあったが、RSI ${inputs.rsi14.toFixed(0)}・出来高${inputs.volumeRatio.toFixed(1)}倍で裏付け不足のため見送り`,
    };
  }

  if (Math.abs(inputs.fullDayMovePct) < th.flatDayPct) {
    return {
      action: 'skip',
      reason: `方向感のない一日（${inputs.fullDayMovePct.toFixed(1)}%）、動かない時は休む（ルール3/4/7）`,
    };
  }
  return {
    action: 'skip',
    reason: '急落条件を満たさず新規買いは見送り（ルール1/2: 急騰は買わない・追わない）',
  };
}

function decideWhileHolding(inputs: RuleInputs, th: DaytradeThresholds): RuleSignal {
  const afternoonSurge = inputs.afternoonMovePct >= th.afternoonSurgePct;
  const morningSurge = inputs.morningMovePct >= th.morningSurgePct;
  const morningCrash = inputs.morningMovePct <= -th.morningCrashPct;

  if (th.stopLossPct > 0 && inputs.avgEntryPrice > 0) {
    const unrealizedPct = ((inputs.dayClose - inputs.avgEntryPrice) / inputs.avgEntryPrice) * 100;
    if (unrealizedPct <= -th.stopLossPct) {
      return {
        action: 'sell',
        reason: `平均取得単価比${unrealizedPct.toFixed(1)}%でストップロス（-${th.stopLossPct}%）に到達、安全策として強制手仕舞い（安全装置: ストップロス）`,
      };
    }
  }

  // Always on, independent of stopLossPct — a close below the 75-day trend
  // line means the buy thesis (dip within an uptrend) no longer holds, which
  // is different from the small day-to-day drawdowns rule 3 says not to
  // panic-sell over. TREND_BREAK_BUFFER_PCT below the line, not right at it,
  // so a position hovering near its SMA doesn't whipsaw sell/re-buy.
  const trendBreakLine = inputs.sma75 * (1 - TREND_BREAK_BUFFER_PCT / 100);
  if (inputs.dayClose < trendBreakLine) {
    return {
      action: 'sell',
      reason: `株価が75日移動平均を${TREND_BREAK_BUFFER_PCT}%超下回りトレンドが崩れたため手仕舞い（トレンド割れ決済）`,
    };
  }

  if (afternoonSurge && inputs.rsi14 >= th.rsiSellConfirmMin) {
    return {
      action: 'sell',
      reason: `午後の急騰（${inputs.afternoonMovePct.toFixed(1)}%）＋RSI ${inputs.rsi14.toFixed(0)}で過熱、利益確定（ルール8: もう一段跳ねたら利確）`,
    };
  }
  if (morningSurge) {
    return {
      action: 'sell',
      reason: `朝の急騰（${inputs.morningMovePct.toFixed(1)}%）を確認、利益確定（ルール1: 朝の急騰は売り）`,
    };
  }
  if (morningCrash) {
    return {
      action: 'hold',
      reason: `朝の急落（${inputs.morningMovePct.toFixed(1)}%）だが、パニック売りはしない（ルール3）`,
    };
  }

  if (inputs.tranchesHeld === 1 && inputs.canPyramidToday) {
    const confirmThreshold = inputs.avgEntryPrice * (1 + th.tranche2ConfirmPct / 100);
    if (inputs.dayClose > confirmThreshold) {
      return {
        action: 'buy',
        trancheNumber: 2,
        reason: `平均取得単価比+${(((inputs.dayClose - inputs.avgEntryPrice) / inputs.avgEntryPrice) * 100).toFixed(1)}%まで上昇し思惑通りに動き始めたため追撃買い（1:2:6の2段階目）`,
      };
    }
  }
  if (inputs.tranchesHeld === 2 && inputs.canPyramidToday) {
    if (inputs.rsi14 > 50 && inputs.dayClose > inputs.lastTrancheEntryPrice) {
      return {
        action: 'buy',
        trancheNumber: 3,
        reason: `RSI ${inputs.rsi14.toFixed(0)}で上昇トレンドが明確になったため本買い（1:2:6の3段階目）`,
      };
    }
  }

  return {
    action: 'hold',
    reason: '利確・追加買いシグナルなし。機械的な損切りはストップロス設定時とトレンド割れ時のみ',
  };
}
