import { avgEntryPrice, calcTotalEquity, calcUnrealizedPnl, totalShares } from './portfolio.ts';
import type { DaytradeState } from './types.ts';

export interface DashboardPosition {
  symbol: string;
  name: string;
  shares: number;
  avgEntryPrice: number;
  currentPrice: number | null; // null when a quote wasn't available this run — dashboard shows avgEntryPrice-based value instead
  marketValue: number;
  unrealizedPnl: number | null;
  firstEntryDate: string;
  tranchesHeld: number;
}

export interface DashboardTrade {
  date: string;
  symbol: string;
  name: string;
  action: 'buy' | 'sell';
  price: number;
  shares: number;
  trancheNumber?: 1 | 2 | 3;
  reason: string;
  realizedPnl?: number;
  tax?: number;
}

export interface DashboardPendingOrder {
  symbol: string;
  name: string;
  action: 'buy' | 'sell';
  trancheNumber?: 1 | 2 | 3;
  limitPrice?: number; // 未設定なら成行（次セッション始値で無条件約定）、設定時は指値
  reason: string;
  queuedDate: string;
}

export interface DashboardData {
  generatedAt: string;
  lastRunDate: string | null;
  lastRunSession: string | null;
  pendingOrders: DashboardPendingOrder[]; // signals decided but not yet filled — see PendingOrder in types.ts
  summary: {
    initialCapitalYen: number;
    cash: number;
    totalEquity: number;
    changePct: number;
    realizedPnlGross: number;
    taxPaidTotal: number;
    commissionPaidTotal: number;
    realizedPnlNet: number;
    unrealizedPnl: number;
  };
  equityHistory: { date: string; session: string; totalEquity: number }[];
  positions: DashboardPosition[];
  trades: DashboardTrade[];
}

/**
 * Builds the JSON payload consumed by docs/daytrade-sim/index.html (fetched
 * client-side as ./data.json). Unlike the Discord embeds, nothing here is
 * length-capped — the dashboard isn't subject to Discord's field/URL limits,
 * so it gets the full equityHistory and full trade log rather than the
 * most-recent-N slices the Discord report is forced to use.
 */
export function buildDashboardData(
  state: DaytradeState,
  currentPrices: Record<string, number>,
  nameFor: (symbol: string) => string,
  initialCapitalYen: number,
): DashboardData {
  const totalEquity = calcTotalEquity(state, currentPrices);
  const unrealizedPnl = calcUnrealizedPnl(state, currentPrices);
  const realizedPnlNet = state.realizedPnlTotal - state.taxPaidTotal - state.commissionPaidTotal;

  const positions: DashboardPosition[] = Object.entries(state.positions).map(([symbol, position]) => {
    const shares = totalShares(position);
    const avgPrice = avgEntryPrice(position);
    const currentPrice = currentPrices[symbol];
    const marketValue = (currentPrice ?? avgPrice) * shares;
    return {
      symbol,
      name: nameFor(symbol),
      shares,
      avgEntryPrice: avgPrice,
      currentPrice: currentPrice ?? null,
      marketValue,
      unrealizedPnl: currentPrice === undefined ? null : (currentPrice - avgPrice) * shares,
      firstEntryDate: position.tranches[0]?.entryDate ?? '',
      tranchesHeld: position.tranches.length,
    };
  });

  const trades: DashboardTrade[] = state.log.map((entry) => ({
    date: entry.date,
    symbol: entry.symbol,
    name: nameFor(entry.symbol),
    action: entry.action,
    price: entry.price,
    shares: entry.shares,
    trancheNumber: entry.trancheNumber,
    reason: entry.reason,
    realizedPnl: entry.realizedPnl,
    tax: entry.tax,
  }));

  const pendingOrders: DashboardPendingOrder[] = Object.entries(state.pendingOrders).map(([symbol, order]) => ({
    symbol,
    name: nameFor(symbol),
    action: order.action,
    trancheNumber: order.trancheNumber,
    limitPrice: order.limitPrice,
    reason: order.reason,
    queuedDate: order.queuedDate,
  }));

  return {
    generatedAt: new Date().toISOString(),
    lastRunDate: state.lastRunDate,
    lastRunSession: state.lastRunSession,
    pendingOrders,
    summary: {
      initialCapitalYen,
      cash: state.cash,
      totalEquity,
      changePct: ((totalEquity - initialCapitalYen) / initialCapitalYen) * 100,
      realizedPnlGross: state.realizedPnlTotal,
      taxPaidTotal: state.taxPaidTotal,
      commissionPaidTotal: state.commissionPaidTotal,
      realizedPnlNet,
      unrealizedPnl,
    },
    equityHistory: state.equityHistory,
    positions,
    trades,
  };
}
