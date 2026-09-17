import type { DaytradePosition, DaytradeState } from './types.ts';

// 立花証券の現物取引は原則100株単位（単元株）— 端数株は発注できない。1:2:6は
// 円の配分比率ではなく「口数」の比率として表現する（2026年8月修正、以前は
// maxPositionYenを1/9:2/9:6/9に分けた円予算で、端数株を許してしまっていた）。
// index.tsの--profile=cheap（1単元10万円未満の銘柄だけをピックアップする
// プロファイル、2026年9月3日追加）が同じ単元株数を使って対象銘柄を絞り込む
// ため、export している。
export const LOT_SIZE = 100;
export const TRANCHE_LOTS: Record<1 | 2 | 3, number> = { 1: 1, 2: 2, 3: 6 };

// Japan's standard withholding rate on listed-stock capital gains in a 特定口座
// (源泉徴収あり): 15% income tax + 0.315% reconstruction surtax + 5% resident
// tax. Not a tunable knob — applied per trade, not netted against same-day
// losses (real 源泉徴収あり accounts do net within the year) — simpler, and
// slightly conservative for judging real viability.
export const TAX_RATE_ON_GAINS = 0.20315;

// 立花証券e支店の現物取引「定額手数料コース」（税込）— 1日の約定代金合計（買い＋売り、
// 複数銘柄・複数回の取引すべて込み）に対するフラット料金。ユーザーが提示・
// https://www.e-shiten.jp/TorihikiRule/cost/ で確認済み（2026年8月時点）。per-trade
// ではなく1日1回だけ発生するため、TAX_RATE_ON_GAINSのようにapplyBuy/applySellでは
// 適用せず、index.tsがその日最後のセッション（afternoon）でまとめて計算・控除する。
const DAILY_COMMISSION_TIERS: readonly { upToYen: number; feeYen: number }[] = [
  { upToYen: 120_000, feeYen: 0 },
  { upToYen: 200_000, feeYen: 176 },
  { upToYen: 500_000, feeYen: 253 },
  { upToYen: 1_000_000, feeYen: 506 },
  { upToYen: 2_000_000, feeYen: 759 },
  { upToYen: 3_000_000, feeYen: 1012 },
  { upToYen: 4_000_000, feeYen: 1265 },
  { upToYen: 5_000_000, feeYen: 1518 },
  { upToYen: 6_000_000, feeYen: 1771 },
  { upToYen: 7_000_000, feeYen: 2024 },
  { upToYen: 8_000_000, feeYen: 2277 },
  { upToYen: 9_000_000, feeYen: 2530 },
  { upToYen: 10_000_000, feeYen: 2783 },
];

/** 1,000万円超は100万円増すごとに253円加算（公式サイト記載の規則）。 */
export function calcDailyCommission(totalContractValueYen: number): number {
  const tier = DAILY_COMMISSION_TIERS.find((t) => totalContractValueYen <= t.upToYen);
  if (tier) {
    return tier.feeYen;
  }
  const lastTier = DAILY_COMMISSION_TIERS.at(-1)!;
  const extraSteps = Math.ceil((totalContractValueYen - lastTier.upToYen) / 1_000_000);
  return lastTier.feeYen + extraSteps * 253;
}

export function totalShares(position: DaytradePosition): number {
  return position.tranches.reduce((sum, tranche) => sum + tranche.shares, 0);
}

/** Cost-basis-weighted average entry price across all tranches. */
export function avgEntryPrice(position: DaytradePosition): number {
  const shares = totalShares(position);
  if (shares === 0) {
    return 0;
  }
  const cost = position.tranches.reduce((sum, tranche) => sum + tranche.shares * tranche.entryPrice, 0);
  return cost / shares;
}

function lastTranche(position: DaytradePosition) {
  return position.tranches.reduce((latest, tranche) => (tranche.trancheNumber > latest.trancheNumber ? tranche : latest));
}

export function lastTrancheEntryPrice(position: DaytradePosition): number {
  return lastTranche(position).entryPrice;
}

export function lastTrancheEntryDate(position: DaytradePosition): string {
  return lastTranche(position).entryDate;
}

/**
 * Adds a tranche (1, 2, or 3 of the 1:2:6 pyramid) to `symbol` — always a
 * whole number of 100-share lots (`TRANCHE_LOTS[trancheNumber] * LOT_SIZE`),
 * never a fractional/rounded-down share count, since real 立花証券 orders
 * can't be placed in anything but 100-share units. All-or-nothing: if the
 * full lot count doesn't fit within available buying power (`cash *
 * marginMultiplier`) *and* within `maxPositionYen` (checked against this
 * symbol's existing cost basis plus this purchase), the tranche is skipped
 * entirely rather than buying a partial amount. `cash` may go negative when
 * leverage is used — that's treated as margin debt (no interest/
 * maintenance-margin modeled, documented in README).
 */
/**
 * Whether adding this tranche at `price` would push `symbol`'s cost basis
 * (existing tranches + this one) past `maxPositionYen`. Exported so callers
 * can reject a signal *before* queueing it as a PendingOrder — a symbol
 * priced high enough that even tranche 1 blows the per-symbol cap can never
 * fill, so there's no point queuing (and displaying) it only to have it
 * silently no-op here later.
 */
export function exceedsMaxPosition(state: DaytradeState, symbol: string, price: number, trancheNumber: 1 | 2 | 3, maxPositionYen: number): boolean {
  const cost = TRANCHE_LOTS[trancheNumber] * LOT_SIZE * price;
  const existingCostBasis = state.positions[symbol]?.tranches.reduce((sum, t) => sum + t.shares * t.entryPrice, 0) ?? 0;
  return existingCostBasis + cost > maxPositionYen;
}

export function applyBuy(
  state: DaytradeState,
  symbol: string,
  price: number,
  trancheNumber: 1 | 2 | 3,
  maxPositionYen: number,
  marginMultiplier: number,
  date: string,
  reason: string,
): DaytradeState {
  const shares = TRANCHE_LOTS[trancheNumber] * LOT_SIZE;
  const cost = shares * price;
  const buyingPower = state.cash * marginMultiplier;
  const existing = state.positions[symbol];

  if (cost > buyingPower || exceedsMaxPosition(state, symbol, price, trancheNumber, maxPositionYen)) {
    return state;
  }

  const newTranche = { trancheNumber, shares, entryPrice: price, entryDate: date };

  return {
    ...state,
    cash: state.cash - cost,
    positions: { ...state.positions, [symbol]: { tranches: [...(existing?.tranches ?? []), newTranche] } },
    log: [...state.log, { date, symbol, action: 'buy', price, shares, reason, trancheNumber }],
  };
}

/** Closes every tranche of the position in `symbol` at `price` in one go (no partial exits). No-op if there is no position to sell. */
export function applySell(state: DaytradeState, symbol: string, price: number, date: string, reason: string): DaytradeState {
  const position = state.positions[symbol];
  if (!position) {
    return state;
  }

  const shares = totalShares(position);
  const costBasis = position.tranches.reduce((sum, tranche) => sum + tranche.shares * tranche.entryPrice, 0);
  const proceeds = shares * price;
  const realizedPnl = proceeds - costBasis;
  const tax = realizedPnl > 0 ? realizedPnl * TAX_RATE_ON_GAINS : 0;
  const remainingPositions = { ...state.positions };
  delete remainingPositions[symbol];

  return {
    ...state,
    cash: state.cash + proceeds - tax,
    realizedPnlTotal: state.realizedPnlTotal + realizedPnl,
    taxPaidTotal: state.taxPaidTotal + tax,
    positions: remainingPositions,
    log: [...state.log, { date, symbol, action: 'sell', price, shares, reason, realizedPnl, tax }],
  };
}

/** Sum of (currentPrice - avgEntryPrice) * totalShares across all open positions. Positions with no known current price are skipped. */
export function calcUnrealizedPnl(state: DaytradeState, currentPrices: Record<string, number>): number {
  return Object.entries(state.positions).reduce((sum, [symbol, position]) => {
    const currentPrice = currentPrices[symbol];
    return currentPrice === undefined ? sum : sum + (currentPrice - avgEntryPrice(position)) * totalShares(position);
  }, 0);
}

/** Cash plus the mark-to-market value of open positions (falling back to avg entry price if a current price is unavailable). */
export function calcTotalEquity(state: DaytradeState, currentPrices: Record<string, number>): number {
  const positionsValue = Object.entries(state.positions).reduce((sum, [symbol, position]) => {
    const currentPrice = currentPrices[symbol] ?? avgEntryPrice(position);
    return sum + currentPrice * totalShares(position);
  }, 0);
  return state.cash + positionsValue;
}

/**
 * Deducts the day's flat commission (see calcDailyCommission) from cash and
 * adds it to the running total. Unlike applyBuy/applySell this isn't called
 * per-trade — index.ts calls it once, at the afternoon session, using that
 * day's full buy+sell contract-value total (both sessions combined).
 */
export function applyDailyCommission(state: DaytradeState, feeYen: number): DaytradeState {
  if (feeYen === 0) {
    return state;
  }
  return { ...state, cash: state.cash - feeYen, commissionPaidTotal: state.commissionPaidTotal + feeYen };
}
