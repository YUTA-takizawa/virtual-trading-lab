import { avgEntryPriceUsd, calcTotalEquityJpy, calcUnrealizedPnlJpy, totalShares } from './portfolio.ts';
import type { DaytradeUsState } from './types.ts';

export interface DashboardPositionUs {
  symbol: string;
  name: string;
  shares: number;
  avgEntryPriceUsd: number;
  currentPriceUsd: number | null;
  marketValueJpy: number;
  unrealizedPnlJpy: number | null;
  firstEntryDate: string;
  tranchesHeld: number;
}

export interface DashboardTradeUs {
  date: string;
  symbol: string;
  name: string;
  action: 'buy' | 'sell';
  priceUsd: number;
  fxRate: number;
  shares: number;
  reason: string;
  trancheNumber?: 1 | 2 | 3;
  realizedPnlJpy?: number;
  tax?: number;
}

export interface DashboardPendingOrderUs {
  symbol: string;
  name: string;
  action: 'buy' | 'sell';
  trancheNumber?: 1 | 2 | 3;
  reason: string;
  queuedDate: string;
}

export interface DashboardDataUs {
  generatedAt: string;
  lastRunDate: string | null;
  currentFxRate: number;
  pendingOrders: DashboardPendingOrderUs[];
  summary: {
    initialCapitalYen: number;
    cashJpy: number;
    totalEquityJpy: number;
    changePct: number;
    realizedPnlGrossJpy: number; // already nets out SEC/FINRA fees, only tax is separate — see portfolio.ts applySell
    taxPaidTotalJpy: number;
    realizedPnlNetJpy: number;
    unrealizedPnlJpy: number;
    secFeeTotalUsd: number;
    finraFeeTotalUsd: number;
  };
  equityHistory: { date: string; totalEquityJpy: number }[];
  positions: DashboardPositionUs[];
  trades: DashboardTradeUs[];
}

/** Same "no length cap" rationale as the JP dashboard.ts — this isn't subject to Discord's field/URL limits. */
export function buildDashboardDataUs(
  state: DaytradeUsState,
  currentPricesUsd: Record<string, number>,
  currentFxRate: number,
  nameFor: (symbol: string) => string,
  initialCapitalYen: number,
): DashboardDataUs {
  const totalEquityJpy = calcTotalEquityJpy(state, currentPricesUsd, currentFxRate);
  const unrealizedPnlJpy = calcUnrealizedPnlJpy(state, currentPricesUsd, currentFxRate);
  const realizedPnlNetJpy = state.realizedPnlTotalJpy - state.taxPaidTotalJpy;

  const positions: DashboardPositionUs[] = Object.entries(state.positions).map(([symbol, position]) => {
    const shares = totalShares(position);
    const avgPriceUsd = avgEntryPriceUsd(position);
    const currentPriceUsd = currentPricesUsd[symbol];
    const marketValueJpy = (currentPriceUsd ?? avgPriceUsd) * shares * currentFxRate;
    return {
      symbol,
      name: nameFor(symbol),
      shares,
      avgEntryPriceUsd: avgPriceUsd,
      currentPriceUsd: currentPriceUsd ?? null,
      marketValueJpy,
      unrealizedPnlJpy: currentPriceUsd === undefined ? null : (currentPriceUsd - avgPriceUsd) * shares * currentFxRate,
      firstEntryDate: position.tranches[0]?.entryDate ?? '',
      tranchesHeld: position.tranches.length,
    };
  });

  const trades: DashboardTradeUs[] = state.log.map((entry) => ({
    date: entry.date,
    symbol: entry.symbol,
    name: nameFor(entry.symbol),
    action: entry.action,
    priceUsd: entry.priceUsd,
    fxRate: entry.fxRate,
    shares: entry.shares,
    reason: entry.reason,
    trancheNumber: entry.trancheNumber,
    realizedPnlJpy: entry.realizedPnlJpy,
    tax: entry.tax,
  }));

  const pendingOrders: DashboardPendingOrderUs[] = Object.entries(state.pendingOrders).map(([symbol, order]) => ({
    symbol,
    name: nameFor(symbol),
    action: order.action,
    trancheNumber: order.trancheNumber,
    reason: order.reason,
    queuedDate: order.queuedDate,
  }));

  return {
    generatedAt: new Date().toISOString(),
    lastRunDate: state.lastRunDate,
    currentFxRate,
    pendingOrders,
    summary: {
      initialCapitalYen,
      cashJpy: state.cashJpy,
      totalEquityJpy,
      changePct: ((totalEquityJpy - initialCapitalYen) / initialCapitalYen) * 100,
      realizedPnlGrossJpy: state.realizedPnlTotalJpy,
      taxPaidTotalJpy: state.taxPaidTotalJpy,
      realizedPnlNetJpy,
      unrealizedPnlJpy,
      secFeeTotalUsd: state.secFeeTotalUsd,
      finraFeeTotalUsd: state.finraFeeTotalUsd,
    },
    equityHistory: state.equityHistory,
    positions,
    trades,
  };
}
