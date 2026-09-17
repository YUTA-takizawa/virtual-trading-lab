import type { StrategyPosition, StrategyState } from './types.ts';
import { calcSecFeeUsd, calcFinraFeeUsd } from '../daytrade-sim-us/portfolio.ts';

// USD建て一本で運用し、為替は一切扱わない（types.tsの冒頭コメント参照）。
// ビッド・アスクスプレッドはこのプロジェクトの他の米国株ロジック（daytrade-
// sim-us）でもモデル化していないため、ここでも意図的に省略する。一方、
// 売却時に実在するSEC Fee・FINRA Feeはdaytrade-sim-us/portfolio.tsの実装を
// そのまま再利用する（無視すると机上の空論になりやすい実コストのため）。
// ウィブル証券の端株取引（0.00001株単位）に合わせ、購入株数は同じ精度で
// 切り捨てる。
const SHARE_PRECISION = 100_000; // 1 / 0.00001

export function totalQuantity(position: StrategyPosition): number {
  return position.lots.reduce((sum, l) => sum + l.quantity, 0);
}

export function avgEntryPriceUsd(position: StrategyPosition): number {
  const quantity = totalQuantity(position);
  if (quantity === 0) return 0;
  const cost = position.lots.reduce((sum, l) => sum + l.quantity * l.entryPriceUsd, 0);
  return cost / quantity;
}

/**
 * Spends up to budgetUsd (capped by available cash) on `symbol` at the
 * current price, adding a new lot. Same "explicit budget, not a fixed
 * tranche fraction" design as crypto-strategy-lab/portfolio.ts — how much to
 * spend on a given buy is each strategy's own decision.
 */
export function applyBuy(state: StrategyState, symbol: string, priceUsd: number, budgetUsd: number, date: string, reason: string): StrategyState {
  const spendableUsd = Math.min(budgetUsd, state.cashUsd);
  if (spendableUsd < 0.01) {
    return state;
  }
  const quantity = Math.floor((spendableUsd / priceUsd) * SHARE_PRECISION) / SHARE_PRECISION;
  if (quantity <= 0) {
    return state;
  }

  const costUsd = quantity * priceUsd;
  const existing = state.positions[symbol];
  const newLot = { quantity, entryPriceUsd: priceUsd, entryDate: date };

  return {
    ...state,
    cashUsd: state.cashUsd - costUsd,
    positions: { ...state.positions, [symbol]: { lots: [...(existing?.lots ?? []), newLot] } },
    log: [...state.log, { date, symbol, action: 'buy', priceUsd, quantity, reason }],
  };
}

/** Closes the entire position in `symbol` at once. SEC/FINRA fees are deducted from proceeds before crediting cash, matching a real broker statement. */
export function applySell(state: StrategyState, symbol: string, priceUsd: number, date: string, reason: string): StrategyState {
  const position = state.positions[symbol];
  if (!position) return state;

  const quantity = totalQuantity(position);
  const grossProceedsUsd = quantity * priceUsd;
  const secFeeUsd = calcSecFeeUsd(grossProceedsUsd);
  const finraFeeUsd = calcFinraFeeUsd(quantity);
  const feesUsd = secFeeUsd + finraFeeUsd;
  const netProceedsUsd = grossProceedsUsd - feesUsd;

  const costBasisUsd = position.lots.reduce((sum, l) => sum + l.quantity * l.entryPriceUsd, 0);
  const realizedPnlUsd = netProceedsUsd - costBasisUsd;

  const remainingPositions = { ...state.positions };
  delete remainingPositions[symbol];

  return {
    ...state,
    cashUsd: state.cashUsd + netProceedsUsd,
    realizedPnlTotalUsd: state.realizedPnlTotalUsd + realizedPnlUsd,
    feesPaidTotalUsd: state.feesPaidTotalUsd + feesUsd,
    positions: remainingPositions,
    log: [...state.log, { date, symbol, action: 'sell', priceUsd, quantity, reason, realizedPnlUsd, feesUsd }],
  };
}

export function calcUnrealizedPnlUsd(state: StrategyState, currentPricesUsd: Record<string, number>): number {
  return Object.entries(state.positions).reduce((sum, [symbol, position]) => {
    const price = currentPricesUsd[symbol];
    if (price === undefined) return sum;
    return sum + (price - avgEntryPriceUsd(position)) * totalQuantity(position);
  }, 0);
}

export function calcTotalEquityUsd(state: StrategyState, currentPricesUsd: Record<string, number>): number {
  const positionsValueUsd = Object.entries(state.positions).reduce((sum, [symbol, position]) => {
    const price = currentPricesUsd[symbol];
    if (price !== undefined) {
      return sum + price * totalQuantity(position);
    }
    return sum + position.lots.reduce((s, l) => s + l.quantity * l.entryPriceUsd, 0);
  }, 0);
  return state.cashUsd + positionsValueUsd;
}
