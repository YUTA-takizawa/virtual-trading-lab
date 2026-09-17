import type { StrategyPosition, StrategyState } from './types.ts';

// このラボの現時点で唯一の戦略（スイングブラケット）は「1単元＝100株」を
// 明示的な単位として扱う設計（config/jp-strategy-lab-swing-bracket.jsonの
// note参照）のため、他のラボ（crypto-strategy-lab/us-strategy-lab）の
// 「budgetJpy円分を買えるだけ買う」という汎用実装とは異なり、株数を直接
// 指定して買う。スプレッド・売買手数料は意図的にモデル化していない——SBI
// 証券・楽天証券とも2023年以降、国内株式売買手数料は原則無料（いわゆる
// ゼロ革命）のため、手数料ゼロは非現実的な簡略化ではなく実態に即した前提。

export function totalQuantity(position: StrategyPosition): number {
  return position.lots.reduce((sum, l) => sum + l.quantity, 0);
}

export function avgEntryPriceJpy(position: StrategyPosition): number {
  const quantity = totalQuantity(position);
  if (quantity === 0) return 0;
  const cost = position.lots.reduce((sum, l) => sum + l.quantity * l.entryPriceJpy, 0);
  return cost / quantity;
}

/** Buys an exact `quantity` of `symbol` at `priceJpy` (not a budget-fractional amount). No-op if the cash doesn't cover it. */
export function applyBuy(state: StrategyState, symbol: string, priceJpy: number, quantity: number, date: string, reason: string): StrategyState {
  const costJpy = quantity * priceJpy;
  if (quantity <= 0 || costJpy > state.cashJpy) {
    return state;
  }

  const existing = state.positions[symbol];
  const newLot = { quantity, entryPriceJpy: priceJpy, entryDate: date };

  return {
    ...state,
    cashJpy: state.cashJpy - costJpy,
    positions: { ...state.positions, [symbol]: { lots: [...(existing?.lots ?? []), newLot] } },
    log: [...state.log, { date, symbol, action: 'buy', priceJpy, quantity, reason }],
  };
}

/** Closes the entire position in `symbol` at once. */
export function applySell(state: StrategyState, symbol: string, priceJpy: number, date: string, reason: string): StrategyState {
  const position = state.positions[symbol];
  if (!position) return state;

  const quantity = totalQuantity(position);
  const proceedsJpy = quantity * priceJpy;
  const costBasisJpy = position.lots.reduce((sum, l) => sum + l.quantity * l.entryPriceJpy, 0);
  const realizedPnlJpy = proceedsJpy - costBasisJpy;

  const remainingPositions = { ...state.positions };
  delete remainingPositions[symbol];

  return {
    ...state,
    cashJpy: state.cashJpy + proceedsJpy,
    realizedPnlTotalJpy: state.realizedPnlTotalJpy + realizedPnlJpy,
    positions: remainingPositions,
    log: [...state.log, { date, symbol, action: 'sell', priceJpy, quantity, reason, realizedPnlJpy }],
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
