import { avgEntryPriceJpy, calcTotalEquityJpy, calcUnrealizedPnlJpy, totalQuantity } from './portfolio.ts';
import type { Strategy, StrategyState } from './types.ts';
import type { DaytradeCryptoCandidate } from '../daytrade-sim-crypto/types.ts';

export interface StrategySummary {
  id: string;
  name: string;
  description: string;
  initialCapitalYen: number;
  cashJpy: number;
  totalEquityJpy: number;
  changePct: number;
  realizedPnlJpy: number;
  spreadCostTotalJpy: number;
  unrealizedPnlJpy: number;
  tradeCount: number;
  openPositions: number;
}

export interface DashboardPositionLab {
  symbol: string;
  name: string;
  quantity: number;
  avgEntryPriceJpy: number;
  currentPriceJpy: number | null;
  marketValueJpy: number;
  unrealizedPnlJpy: number | null;
  firstEntryDate: string;
}

export interface DashboardTradeLab {
  date: string;
  symbol: string;
  name: string;
  action: 'buy' | 'sell';
  priceJpy: number;
  quantity: number;
  reason: string;
  realizedPnlJpy?: number;
}

export interface DashboardDataLab {
  generatedAt: string;
  lastPublishedAt: string;
  strategies: StrategySummary[]; // 開始来の騰落率が高い順
  equityHistories: Record<string, { date: string; totalEquityJpy: number }[]>;
  positions: Record<string, DashboardPositionLab[]>;
  trades: Record<string, DashboardTradeLab[]>;
}

/** Builds the comparison payload consumed by docs/crypto-strategy-lab/index.html. Same "no length cap" rationale as the other daytrade-sim dashboards. */
export function buildDashboardData(
  strategies: Strategy[],
  states: Record<string, StrategyState>,
  currentPricesJpy: Record<string, number>,
  candidates: DaytradeCryptoCandidate[],
  initialCapitalYen: number,
): DashboardDataLab {
  const nameFor = (symbol: string) => candidates.find((c) => c.symbol === symbol)?.name ?? symbol;

  const summaries: StrategySummary[] = strategies.map((strategy) => {
    const state = states[strategy.id]!;
    const totalEquityJpy = calcTotalEquityJpy(state, currentPricesJpy);
    const unrealizedPnlJpy = calcUnrealizedPnlJpy(state, currentPricesJpy);
    return {
      id: strategy.id,
      name: strategy.name,
      description: strategy.description,
      initialCapitalYen,
      cashJpy: state.cashJpy,
      totalEquityJpy,
      changePct: ((totalEquityJpy - initialCapitalYen) / initialCapitalYen) * 100,
      realizedPnlJpy: state.realizedPnlTotalJpy,
      spreadCostTotalJpy: state.spreadCostTotalJpy,
      unrealizedPnlJpy,
      tradeCount: state.log.length,
      openPositions: Object.keys(state.positions).length,
    };
  });
  summaries.sort((a, b) => b.changePct - a.changePct);

  const equityHistories: Record<string, { date: string; totalEquityJpy: number }[]> = {};
  const positions: Record<string, DashboardPositionLab[]> = {};
  const trades: Record<string, DashboardTradeLab[]> = {};

  for (const strategy of strategies) {
    const state = states[strategy.id]!;
    equityHistories[strategy.id] = state.equityHistory;

    positions[strategy.id] = Object.entries(state.positions).map(([symbol, position]) => {
      const quantity = totalQuantity(position);
      const avgPriceJpy = avgEntryPriceJpy(position);
      const currentPriceJpy = currentPricesJpy[symbol];
      return {
        symbol,
        name: nameFor(symbol),
        quantity,
        avgEntryPriceJpy: avgPriceJpy,
        currentPriceJpy: currentPriceJpy ?? null,
        marketValueJpy: (currentPriceJpy ?? avgPriceJpy) * quantity,
        unrealizedPnlJpy: currentPriceJpy === undefined ? null : (currentPriceJpy - avgPriceJpy) * quantity,
        firstEntryDate: position.lots[0]?.entryDate ?? '',
      };
    });

    trades[strategy.id] = state.log.map((entry) => ({
      date: entry.date,
      symbol: entry.symbol,
      name: nameFor(entry.symbol),
      action: entry.action,
      priceJpy: entry.priceJpy,
      quantity: entry.quantity,
      reason: entry.reason,
      realizedPnlJpy: entry.realizedPnlJpy,
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
