import { avgEntryPriceJpy, calcTotalEquityJpy, calcUnrealizedPnlJpy, totalQuantity } from './portfolio.ts';
import type { DaytradeCryptoState } from './types.ts';

export interface DashboardPositionCrypto {
  symbol: string;
  name: string;
  quantity: number;
  avgEntryPriceJpy: number;
  currentPriceJpy: number | null;
  marketValueJpy: number;
  unrealizedPnlJpy: number | null;
  firstEntryDate: string;
  tranchesHeld: number;
}

export interface DashboardTradeCrypto {
  date: string;
  symbol: string;
  name: string;
  action: 'buy' | 'sell';
  priceJpy: number;
  quantity: number;
  reason: string;
  trancheNumber?: 1 | 2 | 3;
  realizedPnlJpy?: number;
  spreadCostJpy?: number;
}

export interface DashboardDataCrypto {
  generatedAt: string;
  lastDashboardPublishedAt: string | null; // when this JSON was (re)written — gated independently of Discord notifications, see DASHBOARD_PUBLISH_INTERVAL_HOURS in index.ts
  lastNotifiedAt: string | null; // last Discord notification — a separate, coarser cadence (NOTIFY_INTERVAL_HOURS)
  summary: {
    initialCapitalYen: number;
    cashJpy: number;
    totalEquityJpy: number;
    changePct: number;
    realizedPnlJpy: number; // 税引き前・スプレッド込み（このシミュレーターは税金を計算しない）
    spreadCostTotalJpy: number;
    unrealizedPnlJpy: number;
  };
  equityHistory: { date: string; session: string; totalEquityJpy: number }[];
  positions: DashboardPositionCrypto[];
  trades: DashboardTradeCrypto[];
}

/** Same "no length cap" rationale as the JP/US dashboard.ts — not subject to Discord's field/URL limits. */
export function buildDashboardDataCrypto(
  state: DaytradeCryptoState,
  currentPricesJpy: Record<string, number>,
  nameFor: (symbol: string) => string,
  initialCapitalYen: number,
): DashboardDataCrypto {
  const totalEquityJpy = calcTotalEquityJpy(state, currentPricesJpy);
  const unrealizedPnlJpy = calcUnrealizedPnlJpy(state, currentPricesJpy);

  const positions: DashboardPositionCrypto[] = Object.entries(state.positions).map(([symbol, position]) => {
    const quantity = totalQuantity(position);
    const avgPriceJpy = avgEntryPriceJpy(position);
    const currentPriceJpy = currentPricesJpy[symbol];
    const marketValueJpy = (currentPriceJpy ?? avgPriceJpy) * quantity;
    return {
      symbol,
      name: nameFor(symbol),
      quantity,
      avgEntryPriceJpy: avgPriceJpy,
      currentPriceJpy: currentPriceJpy ?? null,
      marketValueJpy,
      unrealizedPnlJpy: currentPriceJpy === undefined ? null : (currentPriceJpy - avgPriceJpy) * quantity,
      firstEntryDate: position.tranches[0]?.entryDate ?? '',
      tranchesHeld: position.tranches.length,
    };
  });

  const trades: DashboardTradeCrypto[] = state.log.map((entry) => ({
    date: entry.date,
    symbol: entry.symbol,
    name: nameFor(entry.symbol),
    action: entry.action,
    priceJpy: entry.priceJpy,
    quantity: entry.quantity,
    reason: entry.reason,
    trancheNumber: entry.trancheNumber,
    realizedPnlJpy: entry.realizedPnlJpy,
    spreadCostJpy: entry.spreadCostJpy,
  }));

  return {
    generatedAt: new Date().toISOString(),
    lastDashboardPublishedAt: state.lastDashboardPublishedAt,
    lastNotifiedAt: state.lastNotifiedAt,
    summary: {
      initialCapitalYen,
      cashJpy: state.cashJpy,
      totalEquityJpy,
      changePct: ((totalEquityJpy - initialCapitalYen) / initialCapitalYen) * 100,
      realizedPnlJpy: state.realizedPnlTotalJpy,
      spreadCostTotalJpy: state.spreadCostTotalJpy,
      unrealizedPnlJpy,
    },
    equityHistory: state.dashboardEquityHistory, // 通知用equityHistory（8時間おき）とは別系統。ダッシュボード専用に1時間おきで記録している
    positions,
    trades,
  };
}
