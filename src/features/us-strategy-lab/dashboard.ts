import { avgEntryPriceUsd, calcTotalEquityUsd, calcUnrealizedPnlUsd, totalQuantity } from './portfolio.ts';
import type { Strategy, StrategyState } from './types.ts';
import type { DaytradeUsCandidate } from '../daytrade-sim-us/types.ts';

export interface StrategySummary {
  id: string;
  name: string;
  description: string;
  initialCapitalUsd: number;
  cashUsd: number;
  totalEquityUsd: number;
  changePct: number;
  realizedPnlUsd: number;
  feesPaidTotalUsd: number;
  unrealizedPnlUsd: number;
  tradeCount: number;
  openPositions: number;
  pendingOrderCount: number; // 発注済みだがまだ約定していない指値/成行注文の数（2026年9月1日追加）
}

export interface DashboardPositionLab {
  symbol: string;
  name: string;
  quantity: number;
  avgEntryPriceUsd: number;
  currentPriceUsd: number | null;
  marketValueUsd: number;
  unrealizedPnlUsd: number | null;
  firstEntryDate: string;
}

export interface DashboardTradeLab {
  date: string;
  symbol: string;
  name: string;
  action: 'buy' | 'sell';
  priceUsd: number;
  quantity: number;
  reason: string;
  realizedPnlUsd?: number;
}

export interface DashboardDataLab {
  generatedAt: string;
  lastPublishedAt: string;
  strategies: StrategySummary[]; // 開始来の騰落率が高い順
  equityHistories: Record<string, { date: string; totalEquityUsd: number }[]>;
  positions: Record<string, DashboardPositionLab[]>;
  trades: Record<string, DashboardTradeLab[]>;
}

/** Builds the comparison payload consumed by docs/us-strategy-lab/index.html. USD版crypto-strategy-lab/dashboard.tsと同じ構造。 */
export function buildDashboardData(
  strategies: Strategy[],
  states: Record<string, StrategyState>,
  currentPricesUsd: Record<string, number>,
  candidates: DaytradeUsCandidate[],
  initialCapitalUsd: number,
): DashboardDataLab {
  const nameFor = (symbol: string) => candidates.find((c) => c.symbol === symbol)?.name ?? symbol;

  const summaries: StrategySummary[] = strategies.map((strategy) => {
    const state = states[strategy.id]!;
    const totalEquityUsd = calcTotalEquityUsd(state, currentPricesUsd);
    const unrealizedPnlUsd = calcUnrealizedPnlUsd(state, currentPricesUsd);
    return {
      id: strategy.id,
      name: strategy.name,
      description: strategy.description,
      initialCapitalUsd,
      cashUsd: state.cashUsd,
      totalEquityUsd,
      changePct: ((totalEquityUsd - initialCapitalUsd) / initialCapitalUsd) * 100,
      realizedPnlUsd: state.realizedPnlTotalUsd,
      feesPaidTotalUsd: state.feesPaidTotalUsd,
      unrealizedPnlUsd,
      tradeCount: state.log.length,
      openPositions: Object.keys(state.positions).length,
      pendingOrderCount: Object.keys(state.pendingOrders).length,
    };
  });
  summaries.sort((a, b) => b.changePct - a.changePct);

  const equityHistories: Record<string, { date: string; totalEquityUsd: number }[]> = {};
  const positions: Record<string, DashboardPositionLab[]> = {};
  const trades: Record<string, DashboardTradeLab[]> = {};

  for (const strategy of strategies) {
    const state = states[strategy.id]!;
    equityHistories[strategy.id] = state.equityHistory;

    positions[strategy.id] = Object.entries(state.positions).map(([symbol, position]) => {
      const quantity = totalQuantity(position);
      const avgPriceUsd = avgEntryPriceUsd(position);
      const currentPriceUsd = currentPricesUsd[symbol];
      return {
        symbol,
        name: nameFor(symbol),
        quantity,
        avgEntryPriceUsd: avgPriceUsd,
        currentPriceUsd: currentPriceUsd ?? null,
        marketValueUsd: (currentPriceUsd ?? avgPriceUsd) * quantity,
        unrealizedPnlUsd: currentPriceUsd === undefined ? null : (currentPriceUsd - avgPriceUsd) * quantity,
        firstEntryDate: position.lots[0]?.entryDate ?? '',
      };
    });

    trades[strategy.id] = state.log.map((entry) => ({
      date: entry.date,
      symbol: entry.symbol,
      name: nameFor(entry.symbol),
      action: entry.action,
      priceUsd: entry.priceUsd,
      quantity: entry.quantity,
      reason: entry.reason,
      realizedPnlUsd: entry.realizedPnlUsd,
    }));
  }

  return {
    generatedAt: new Date().toISOString(),
    lastPublishedAt: new Date().toISOString(),
    strategies: summaries,
    equityHistories,
    positions,
    trades,
  };
}
