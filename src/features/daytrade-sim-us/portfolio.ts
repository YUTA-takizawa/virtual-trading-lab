import type { DaytradeUsPosition, DaytradeUsState } from './types.ts';

// Reverted to the JP simulator's *pre*-100-share-lot design per user
// direction: US orders (via Webull) aren't constrained to 100-share units
// the way 立花証券's TSE orders are, so tranche sizing stays a yen-fraction
// of maxPositionYen. Webull supports fractional-share orders (端株取引):
// dollar-denominated ("金額指定") orders execute in $1 increments, and
// share-count orders ("株数指定") down to 0.00001 shares — confirmed by the
// user 2026-08-28. applyBuy models a dollar-denominated order (the natural
// fit for a yen-budget-driven tranche), so it spends the full budget down to
// the nearest dollar rather than losing up to a whole share's worth to
// whole-share rounding.
const TRANCHE_WEIGHTS: Record<1 | 2 | 3, number> = { 1: 1 / 9, 2: 2 / 9, 3: 6 / 9 };

// Webull's finest share-count granularity for fractional orders.
const SHARE_PRECISION = 100_000; // 1 / 0.00001

// Same 20.315% rate as JP stocks — confirmed via 国税庁 that FX gain/loss on
// a foreign-currency stock sale is *not* split out as separate misc income,
// it's folded into 株式等の譲渡所得 and taxed together at this same rate.
export const TAX_RATE_ON_GAINS = 0.20315;

// Webull's yen<->dollar conversion spread (税込15銭/ドル, per webull.co.jp/pricing,
// confirmed 2026-08). Applied on top of the market FX rate in both directions:
// buying dollars costs slightly more yen per dollar, selling them back yields
// slightly fewer yen per dollar than the raw mid rate.
export const FX_SPREAD_YEN = 0.15;

// ウィブル証券は2026年7月27日〜米国株の取引手数料を完全無料化（買い・売りとも）。
// 売却時のみ規制当局手数料が別途発生する（webull.co.jp/blog/300 で確認）。CAT Fee
// も実在するが正確な料率を確認できなかったため、金額として無視できるとみなし
// 未モデル化（ドキュメントに明記のうえ意図的に省略）。
export function calcSecFeeUsd(proceedsUsd: number): number {
  return Math.max(proceedsUsd * 0.0000206, 0.01);
}
export function calcFinraFeeUsd(shares: number): number {
  return Math.min(Math.max(shares * 0.000195, 0.01), 9.79);
}

export function totalShares(position: DaytradeUsPosition): number {
  return position.tranches.reduce((sum, t) => sum + t.shares, 0);
}

/** Cost-basis-weighted average entry price in USD (FX-agnostic — used only for USD-denominated threshold comparisons in rules.ts). */
export function avgEntryPriceUsd(position: DaytradeUsPosition): number {
  const shares = totalShares(position);
  if (shares === 0) return 0;
  const cost = position.tranches.reduce((sum, t) => sum + t.shares * t.entryPriceUsd, 0);
  return cost / shares;
}

function lastTranche(position: DaytradeUsPosition) {
  return position.tranches.reduce((latest, t) => (t.trancheNumber > latest.trancheNumber ? t : latest));
}
export function lastTrancheEntryPriceUsd(position: DaytradeUsPosition): number {
  return lastTranche(position).entryPriceUsd;
}
export function lastTrancheEntryDate(position: DaytradeUsPosition): string {
  return lastTranche(position).entryDate;
}

/**
 * Adds a tranche, spending up to that tranche's share of maxPositionYen
 * (converted to USD at the current rate + Webull's buy-side spread), capped
 * by available buying power. Models a dollar-denominated fractional-share
 * order: the USD spend is floored to the nearest whole dollar (Webull's
 * $1 increment for this order type), then the resulting share count is
 * floored to 0.00001 shares (SHARE_PRECISION) — Webull's finest granularity
 * — rather than to a whole share. No-op if the budget can't afford even $1.
 */
export function applyBuy(
  state: DaytradeUsState,
  symbol: string,
  priceUsd: number,
  fxRate: number,
  trancheNumber: 1 | 2 | 3,
  maxPositionYen: number,
  marginMultiplier: number,
  date: string,
  reason: string,
): DaytradeUsState {
  const effectiveBuyRate = fxRate + FX_SPREAD_YEN;
  const trancheBudgetJpy = maxPositionYen * TRANCHE_WEIGHTS[trancheNumber];
  const buyingPowerJpy = state.cashJpy * marginMultiplier;
  const spendableJpy = Math.min(trancheBudgetJpy, buyingPowerJpy);
  const spendableUsd = Math.floor(spendableJpy / effectiveBuyRate);
  if (spendableUsd < 1) {
    return state;
  }
  const shares = Math.floor((spendableUsd / priceUsd) * SHARE_PRECISION) / SHARE_PRECISION;
  if (shares <= 0) {
    return state;
  }

  const costJpy = shares * priceUsd * effectiveBuyRate;
  const existing = state.positions[symbol];
  const newTranche = { trancheNumber, shares, entryPriceUsd: priceUsd, entryFxRate: effectiveBuyRate, entryDate: date };

  return {
    ...state,
    cashJpy: state.cashJpy - costJpy,
    positions: { ...state.positions, [symbol]: { tranches: [...(existing?.tranches ?? []), newTranche] } },
    log: [...state.log, { date, symbol, action: 'buy', priceUsd, fxRate: effectiveBuyRate, shares, reason, trancheNumber }],
  };
}

/**
 * Closes every tranche at once. Each tranche's cost basis is converted back
 * to yen using *that tranche's own* entry FX rate (not today's), since each
 * lot was actually purchased at a different rate — proceeds use today's
 * sell-side rate (market rate - spread) uniformly, matching how a real
 * single sell order settles. SEC/FINRA fees are deducted from USD proceeds
 * before conversion, same as a real broker statement.
 */
export function applySell(state: DaytradeUsState, symbol: string, priceUsd: number, fxRate: number, date: string, reason: string): DaytradeUsState {
  const position = state.positions[symbol];
  if (!position) return state;

  const shares = totalShares(position);
  const effectiveSellRate = fxRate - FX_SPREAD_YEN;

  const grossProceedsUsd = shares * priceUsd;
  const secFeeUsd = calcSecFeeUsd(grossProceedsUsd);
  const finraFeeUsd = calcFinraFeeUsd(shares);
  const netProceedsUsd = grossProceedsUsd - secFeeUsd - finraFeeUsd;
  const proceedsJpy = netProceedsUsd * effectiveSellRate;

  const costBasisJpy = position.tranches.reduce((sum, t) => sum + t.shares * t.entryPriceUsd * t.entryFxRate, 0);
  const realizedPnlJpy = proceedsJpy - costBasisJpy;
  const tax = realizedPnlJpy > 0 ? realizedPnlJpy * TAX_RATE_ON_GAINS : 0;

  const remainingPositions = { ...state.positions };
  delete remainingPositions[symbol];

  return {
    ...state,
    cashJpy: state.cashJpy + proceedsJpy - tax,
    realizedPnlTotalJpy: state.realizedPnlTotalJpy + realizedPnlJpy,
    taxPaidTotalJpy: state.taxPaidTotalJpy + tax,
    secFeeTotalUsd: state.secFeeTotalUsd + secFeeUsd,
    finraFeeTotalUsd: state.finraFeeTotalUsd + finraFeeUsd,
    positions: remainingPositions,
    log: [...state.log, { date, symbol, action: 'sell', priceUsd, fxRate: effectiveSellRate, shares, reason, realizedPnlJpy, tax, secFeeUsd, finraFeeUsd }],
  };
}

/** Sum of (currentPriceUsd - avgEntryPriceUsd) * shares * currentFxRate across all open positions, in yen. Skips positions with no known current price. */
export function calcUnrealizedPnlJpy(state: DaytradeUsState, currentPricesUsd: Record<string, number>, currentFxRate: number): number {
  return Object.entries(state.positions).reduce((sum, [symbol, position]) => {
    const price = currentPricesUsd[symbol];
    if (price === undefined) return sum;
    return sum + (price - avgEntryPriceUsd(position)) * totalShares(position) * currentFxRate;
  }, 0);
}

/** Cash (yen) plus the mark-to-market yen value of open positions (falling back to entry price/entry FX rate if a current quote is unavailable). */
export function calcTotalEquityJpy(state: DaytradeUsState, currentPricesUsd: Record<string, number>, currentFxRate: number): number {
  const positionsValueJpy = Object.entries(state.positions).reduce((sum, [symbol, position]) => {
    const price = currentPricesUsd[symbol];
    if (price !== undefined) {
      return sum + price * totalShares(position) * currentFxRate;
    }
    // No live quote: value each tranche at its own entry price/FX rate rather than guessing.
    return sum + position.tranches.reduce((s, t) => s + t.shares * t.entryPriceUsd * t.entryFxRate, 0);
  }, 0);
  return state.cashJpy + positionsValueJpy;
}
