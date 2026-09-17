import type { DaytradeCryptoThresholds, RuleInputsCrypto, RuleSignalCrypto } from './types.ts';

// Same rationale as the JP/US versions' TREND_BREAK_BUFFER_PCT — a
// hysteresis buffer so a position hovering right at its 75-day SMA doesn't
// whipsaw sell/re-buy.
const TREND_BREAK_BUFFER_PCT = 3;

/**
 * Crypto-market version of the US daytrade-sim rules (相場の8箇条 + trend
 * filter/break), unchanged in shape — crypto trades continuously like the
 * US market (no session split), so every signal compares previous close to
 * the current price (dailyMovePct). The only structural difference from the
 * US version is that this gets evaluated twice a day (morning/night, see
 * index.ts) instead of once, since crypto has no natural daily close to
 * anchor a single check to.
 *
 * Same omissions as the US version: no PER/PBR filter, no earnings-day play
 * (neither concept applies to crypto).
 */
export function decideTradeCrypto(inputs: RuleInputsCrypto, th: DaytradeCryptoThresholds): RuleSignalCrypto {
  return inputs.hasPosition ? decideWhileHolding(inputs, th) : decideWhileFlat(inputs, th);
}

function decideWhileFlat(inputs: RuleInputsCrypto, th: DaytradeCryptoThresholds): RuleSignalCrypto {
  const crash = inputs.dailyMovePct <= -th.crashPct;

  if (crash) {
    const rsiConfirmed = inputs.rsi14 < th.rsiBuyConfirmMax;
    const volumeConfirmed = inputs.volumeRatio >= th.volumeRatioMin;
    const trendOk = inputs.dayClose > inputs.sma75;

    if (trendOk && rsiConfirmed && volumeConfirmed) {
      return {
        action: 'buy',
        trancheNumber: 1,
        reason: `前日比急落（${inputs.dailyMovePct.toFixed(1)}%）を確認、RSI ${inputs.rsi14.toFixed(0)}・出来高${inputs.volumeRatio.toFixed(1)}倍で裏付けあり（ルール1: 急落は買い、打診買い）`,
      };
    }
    if (!trendOk) {
      return {
        action: 'skip',
        reason: `急落（${inputs.dailyMovePct.toFixed(1)}%）はあったが、価格が75日移動平均を下回っており下落トレンド中の可能性が高いため見送り（トレンドフィルタ）`,
      };
    }
    return {
      action: 'skip',
      reason: `急落（${inputs.dailyMovePct.toFixed(1)}%）はあったが、RSI ${inputs.rsi14.toFixed(0)}・出来高${inputs.volumeRatio.toFixed(1)}倍で裏付け不足のため見送り`,
    };
  }

  if (Math.abs(inputs.dailyMovePct) < th.flatDayPct) {
    return {
      action: 'skip',
      reason: `方向感のない一日（${inputs.dailyMovePct.toFixed(1)}%）、動かない時は休む（ルール3/4/7）`,
    };
  }
  return {
    action: 'skip',
    reason: '急落条件を満たさず新規買いは見送り（ルール1/2: 急騰は買わない・追わない）',
  };
}

function decideWhileHolding(inputs: RuleInputsCrypto, th: DaytradeCryptoThresholds): RuleSignalCrypto {
  const surge = inputs.dailyMovePct >= th.surgePct;
  const crash = inputs.dailyMovePct <= -th.crashPct;

  if (th.stopLossPct > 0 && inputs.avgEntryPriceJpy > 0) {
    const unrealizedPct = ((inputs.dayClose - inputs.avgEntryPriceJpy) / inputs.avgEntryPriceJpy) * 100;
    if (unrealizedPct <= -th.stopLossPct) {
      return {
        action: 'sell',
        reason: `平均取得単価比${unrealizedPct.toFixed(1)}%でストップロス（-${th.stopLossPct}%）に到達、安全策として強制手仕舞い（安全装置: ストップロス）`,
      };
    }
  }

  const trendBreakLine = inputs.sma75 * (1 - TREND_BREAK_BUFFER_PCT / 100);
  if (inputs.dayClose < trendBreakLine) {
    return {
      action: 'sell',
      reason: `価格が75日移動平均を${TREND_BREAK_BUFFER_PCT}%超下回りトレンドが崩れたため手仕舞い（トレンド割れ決済）`,
    };
  }

  if (surge && inputs.rsi14 >= th.rsiSellConfirmMin) {
    return {
      action: 'sell',
      reason: `前日比急騰（${inputs.dailyMovePct.toFixed(1)}%）＋RSI ${inputs.rsi14.toFixed(0)}で過熱、利益確定（ルール8: もう一段跳ねたら利確）`,
    };
  }
  if (crash) {
    return {
      action: 'hold',
      reason: `急落（${inputs.dailyMovePct.toFixed(1)}%）だが、パニック売りはしない（ルール3）`,
    };
  }

  if (inputs.tranchesHeld === 1 && inputs.canPyramidToday) {
    const confirmThreshold = inputs.avgEntryPriceJpy * (1 + th.tranche2ConfirmPct / 100);
    if (inputs.dayClose > confirmThreshold) {
      return {
        action: 'buy',
        trancheNumber: 2,
        reason: `平均取得単価比+${(((inputs.dayClose - inputs.avgEntryPriceJpy) / inputs.avgEntryPriceJpy) * 100).toFixed(1)}%まで上昇し思惑通りに動き始めたため追撃買い（1:2:6の2段階目）`,
      };
    }
  }
  if (inputs.tranchesHeld === 2 && inputs.canPyramidToday) {
    if (inputs.rsi14 > 50 && inputs.dayClose > inputs.lastTrancheEntryPriceJpy) {
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
