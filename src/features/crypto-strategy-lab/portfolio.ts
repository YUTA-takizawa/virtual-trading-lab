import type { StrategyPosition, StrategyState } from './types.ts';

// 同じGMOコイン現物取引「販売所」を想定した近似スプレッド（src/features/
// daytrade-sim-crypto/portfolio.tsのSPREAD_PCTと同じ根拠・同じ値）。
export const SPREAD_PCT = 0.5;
const QUANTITY_PRECISION = 100_000_000; // satoshi相当

function buyPrice(midPriceJpy: number): number {
  return midPriceJpy * (1 + SPREAD_PCT / 100);
}
function sellPrice(midPriceJpy: number): number {
  return midPriceJpy * (1 - SPREAD_PCT / 100);
}

export function totalQuantity(position: StrategyPosition): number {
  return position.lots.reduce((sum, l) => sum + l.quantity, 0);
}

export function avgEntryPriceJpy(position: StrategyPosition): number {
  const quantity = totalQuantity(position);
  if (quantity === 0) return 0;
  const cost = position.lots.reduce((sum, l) => sum + l.quantity * l.entryPriceJpy, 0);
  return cost / quantity;
}

/**
 * Spends up to budgetJpy (capped by available cash) on `symbol` at the
 * modeled buy-side spread price, adding a new lot. Unlike daytrade-sim/
 * daytrade-sim-crypto's 1:2:6-tranche applyBuy, this takes an explicit
 * budget instead of a fixed tranche fraction — how much to spend on a given
 * buy (a fixed 1/9 pyramid slice, a flat DCA amount, a grid step, etc.) is
 * each strategy's own decision, not the portfolio layer's.
 */
export function applyBuy(state: StrategyState, symbol: string, midPriceJpy: number, budgetJpy: number, date: string, reason: string): StrategyState {
  const effectiveBuyPrice = buyPrice(midPriceJpy);
  const spendableJpy = Math.min(budgetJpy, state.cashJpy);
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
  const newLot = { quantity, entryPriceJpy: effectiveBuyPrice, entryDate: date };

  return {
    ...state,
    cashJpy: state.cashJpy - costJpy,
    spreadCostTotalJpy: state.spreadCostTotalJpy + spreadCostJpy,
    positions: { ...state.positions, [symbol]: { lots: [...(existing?.lots ?? []), newLot] } },
    log: [...state.log, { date, symbol, action: 'buy', priceJpy: effectiveBuyPrice, quantity, reason, spreadCostJpy }],
  };
}

/** Closes the entire position in `symbol` at once, at the modeled sell-side spread price. No partial exits. */
export function applySell(state: StrategyState, symbol: string, midPriceJpy: number, date: string, reason: string): StrategyState {
  const position = state.positions[symbol];
  if (!position) return state;

  const quantity = totalQuantity(position);
  const effectiveSellPrice = sellPrice(midPriceJpy);

  const proceedsJpy = quantity * effectiveSellPrice;
  const spreadCostJpy = quantity * (midPriceJpy - effectiveSellPrice);
  const costBasisJpy = position.lots.reduce((sum, l) => sum + l.quantity * l.entryPriceJpy, 0);
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

export function calcUnrealizedPnlJpy(state: StrategyState, currentPricesJpy: Record<string, number>): number {
  return Object.entries(state.positions).reduce((sum, [symbol, position]) => {
    const price = currentPricesJpy[symbol];
    if (price === undefined) return sum;
    return sum + (price - avgEntryPriceJpy(position)) * totalQuantity(position);
  }, 0);
}

export function calcTotalEquityJpy(state: StrategyState, currentPricesJpy: Record<string, number>): number {
  const positionsValueJpy = Object.entries(state.positions).reduce((sum, [symbol, position]) => {
    const price = currentPricesJpy[symbol];
    if (price !== undefined) {
      return sum + price * totalQuantity(position);
    }
    return sum + position.lots.reduce((s, l) => s + l.quantity * l.entryPriceJpy, 0);
  }, 0);
  return state.cashJpy + positionsValueJpy;
}
