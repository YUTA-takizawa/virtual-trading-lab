import type { DaytradeCryptoPosition, DaytradeCryptoState } from './types.ts';

// Same yen-fraction tranche sizing as the pre-lot US model (crypto has no
// lot/unit constraint at all — GMO Coin's spot market trades in fractional
// quantities down to whatever QUANTITY_PRECISION allows).
const TRANCHE_WEIGHTS: Record<1 | 2 | 3, number> = { 1: 1 / 9, 2: 2 / 9, 3: 6 / 9 };

// GMOコインの現物取引「販売所」は手数料自体は無料だが、売値と買値の差
// （スプレッド）が実質的なコストとして発生する。公開比較記事の実例
// （ビットコイン買値500万円・売値495万円 = 差5万円 ≈ 1%）を参考にした
// 近似値。GMOコインは正確なスプレッド率を公表しておらず、時間帯・銘柄・
// 市況によって変動するため、買い・売りそれぞれ半分（0.5%）ずつ、
// 往復で約1%相当のコストとしてモデル化する（確認 2026-08-29）。
export const SPREAD_PCT = 0.5;

// Yahoo Financeの終値（中値相当）に対してこの比率を上乗せ/差し引いた価格で
// 約定したものとして扱う。
function buyPrice(midPriceJpy: number): number {
  return midPriceJpy * (1 + SPREAD_PCT / 100);
}
function sellPrice(midPriceJpy: number): number {
  return midPriceJpy * (1 - SPREAD_PCT / 100);
}

// satoshi単位（1億分の1）相当の精度。GMOコインの実際の最小注文単位は銘柄
// ごとに異なり公開情報からは正確に把握できないため、主要取引所で一般的な
// 精度として近似している。
const QUANTITY_PRECISION = 100_000_000;

export function totalQuantity(position: DaytradeCryptoPosition): number {
  return position.tranches.reduce((sum, t) => sum + t.quantity, 0);
}

/** Cost-basis-weighted average entry price in yen. */
export function avgEntryPriceJpy(position: DaytradeCryptoPosition): number {
  const quantity = totalQuantity(position);
  if (quantity === 0) return 0;
  const cost = position.tranches.reduce((sum, t) => sum + t.quantity * t.entryPriceJpy, 0);
  return cost / quantity;
}

function lastTranche(position: DaytradeCryptoPosition) {
  return position.tranches.reduce((latest, t) => (t.trancheNumber > latest.trancheNumber ? t : latest));
}
export function lastTrancheEntryPriceJpy(position: DaytradeCryptoPosition): number {
  return lastTranche(position).entryPriceJpy;
}
export function lastTrancheEntryDate(position: DaytradeCryptoPosition): string {
  return lastTranche(position).entryDate;
}

/**
 * Adds a tranche, spending up to that tranche's share of maxPositionYen
 * (at the modeled buy-side spread price), capped by available buying
 * power. No-op if the budget can't afford a meaningfully non-zero quantity.
 */
export function applyBuy(
  state: DaytradeCryptoState,
  symbol: string,
  midPriceJpy: number,
  trancheNumber: 1 | 2 | 3,
  maxPositionYen: number,
  marginMultiplier: number,
  date: string,
  reason: string,
): DaytradeCryptoState {
  const effectiveBuyPrice = buyPrice(midPriceJpy);
  const trancheBudgetJpy = maxPositionYen * TRANCHE_WEIGHTS[trancheNumber];
  const buyingPowerJpy = state.cashJpy * marginMultiplier;
  const spendableJpy = Math.min(trancheBudgetJpy, buyingPowerJpy);
  if (spendableJpy < 1) {
    return state;
  }
  const quantity = Math.floor((spendableJpy / effectiveBuyPrice) * QUANTITY_PRECISION) / QUANTITY_PRECISION;
  if (quantity <= 0) {
    return state;
  }

  const costJpy = quantity * effectiveBuyPrice;
  const spreadCostJpy = quantity * (effectiveBuyPrice - midPriceJpy);
  const existing = state.positions[symbol];
  const newTranche = { trancheNumber, quantity, entryPriceJpy: effectiveBuyPrice, entryDate: date };

  return {
    ...state,
    cashJpy: state.cashJpy - costJpy,
    spreadCostTotalJpy: state.spreadCostTotalJpy + spreadCostJpy,
    positions: { ...state.positions, [symbol]: { tranches: [...(existing?.tranches ?? []), newTranche] } },
    log: [...state.log, { date, symbol, action: 'buy', priceJpy: effectiveBuyPrice, quantity, reason, trancheNumber, spreadCostJpy }],
  };
}

/** Closes every tranche at once, at the modeled sell-side spread price. No partial exits. */
export function applySell(state: DaytradeCryptoState, symbol: string, midPriceJpy: number, date: string, reason: string): DaytradeCryptoState {
  const position = state.positions[symbol];
  if (!position) return state;

  const quantity = totalQuantity(position);
  const effectiveSellPrice = sellPrice(midPriceJpy);

  const proceedsJpy = quantity * effectiveSellPrice;
  const spreadCostJpy = quantity * (midPriceJpy - effectiveSellPrice);
  const costBasisJpy = position.tranches.reduce((sum, t) => sum + t.quantity * t.entryPriceJpy, 0);
  const realizedPnlJpy = proceedsJpy - costBasisJpy;

  const remainingPositions = { ...state.positions };
  delete remainingPositions[symbol];

  return {
    ...state,
    cashJpy: state.cashJpy + proceedsJpy,
    realizedPnlTotalJpy: state.realizedPnlTotalJpy + realizedPnlJpy,
    spreadCostTotalJpy: state.spreadCostTotalJpy + spreadCostJpy,
    positions: remainingPositions,
    log: [...state.log, { date, symbol, action: 'sell', priceJpy: effectiveSellPrice, quantity, reason, realizedPnlJpy, spreadCostJpy }],
  };
}

/** Sum of (currentPriceJpy - avgEntryPriceJpy) * quantity across all open positions. Skips positions with no known current price. */
export function calcUnrealizedPnlJpy(state: DaytradeCryptoState, currentPricesJpy: Record<string, number>): number {
  return Object.entries(state.positions).reduce((sum, [symbol, position]) => {
    const price = currentPricesJpy[symbol];
    if (price === undefined) return sum;
    return sum + (price - avgEntryPriceJpy(position)) * totalQuantity(position);
  }, 0);
}

/** Cash plus the mark-to-market value of open positions (falling back to entry price if a current quote is unavailable). */
export function calcTotalEquityJpy(state: DaytradeCryptoState, currentPricesJpy: Record<string, number>): number {
  const positionsValueJpy = Object.entries(state.positions).reduce((sum, [symbol, position]) => {
    const price = currentPricesJpy[symbol];
    if (price !== undefined) {
      return sum + price * totalQuantity(position);
    }
    return sum + position.tranches.reduce((s, t) => s + t.quantity * t.entryPriceJpy, 0);
  }, 0);
  return state.cashJpy + positionsValueJpy;
}
