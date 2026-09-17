import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readJsonConfig } from '../../shared/personalConfig.ts';
import { readJsonData, writeJsonData } from '../../shared/dataFile.ts';
import { postDiscordAlert } from '../../shared/discordClient.ts';
import { logger } from '../../util/logger.ts';
import { todayJstDateString } from '../../shared/jstDate.ts';
import { fetchDailyHistory, type DailyHistory } from '../daytrade-sim/marketData.ts';
import { calcRsi14, calcSma, calcVolumeRatio } from './indicators.ts';
import { applyBuy, applySell, calcTotalEquityJpy } from './portfolio.ts';
import { createInitialStrategyState } from './types.ts';
import type { LabMeta, PendingOrderLab, StrategyState, SymbolSnapshot } from './types.ts';
import { STRATEGIES } from './strategies/index.ts';
import { buildDashboardData } from './dashboard.ts';
import type { DaytradeConfig } from '../daytrade-sim/types.ts';

const VIRTUAL_CAPITAL_YEN = 3_000_000; // ¥500,000 × 6枠（ユーザー指定）
const MIN_HISTORY_DAYS = 76; // 75日SMA + 前日終値比較に必要な最小日数
const LOG_RETENTION_DAYS = 90;
// 指値が刺さらないまま放置されるのを防ぐ有効期限（約2週間の実行回数分）。
// 現実の指値注文にも期限があるのと同じ考え方（us-strategy-lab/daytrade-sim
// と同じ定数）。
const LIMIT_ORDER_EXPIRY_DAYS = 10;

const DASHBOARD_DATA_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'jp-strategy-lab', 'data.json');
const META_FILE = 'jp-strategy-lab-meta.json';

function stateFileName(strategyId: string): string {
  return `jp-strategy-lab-${strategyId}-state.json`;
}

function daysSince(dateStr: string, today: string): number {
  return (new Date(today).getTime() - new Date(dateStr).getTime()) / (24 * 60 * 60 * 1000);
}

function buildSnapshot(symbol: string, date: string, history: DailyHistory): SymbolSnapshot {
  const { closes, volumes } = history;
  const dayClose = closes.at(-1)!;
  const previousClose = closes.at(-2)!;
  return {
    symbol,
    date,
    dayClose,
    dailyMovePct: ((dayClose - previousClose) / previousClose) * 100,
    rsi14: calcRsi14(closes),
    volumeRatio: calcVolumeRatio(volumes),
    sma75: calcSma(closes, 75),
  };
}

function pruneLog(state: StrategyState, today: string): StrategyState {
  const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const keep = (date: string) => date === today || new Date(date).getTime() >= cutoff;
  return { ...state, log: state.log.filter((e) => keep(e.date)), equityHistory: state.equityHistory.filter((p) => keep(p.date)) };
}

function queuePendingOrder(state: StrategyState, symbol: string, order: PendingOrderLab): StrategyState {
  return { ...state, pendingOrders: { ...state.pendingOrders, [symbol]: order } };
}

function clearPendingOrder(state: StrategyState, symbol: string): StrategyState {
  if (!(symbol in state.pendingOrders)) return state;
  const rest = { ...state.pendingOrders };
  delete rest[symbol];
  return { ...state, pendingOrders: rest };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  // config/daytrade.json（機能6の既定プロファイルと共有、二重管理を避ける）
  // の候補527銘柄をそのまま流用する。
  const config = await readJsonConfig<DaytradeConfig>('daytrade.json');
  const now = new Date();
  const today = todayJstDateString(now);

  const meta = await readJsonData<LabMeta>(META_FILE, { lastPublishedAt: null, lastRunDate: null });
  if (meta.lastRunDate === today && !dryRun) {
    // GitHub Actionsのschedule遅延対策として併用しているWindows Task
    // Schedulerと、GitHub自身のcronが同日に重複発火した場合のガード。
    logger.info(`jp-strategy-lab: already ran today (${today}), skipping duplicate trigger`);
    return;
  }

  const states: Record<string, StrategyState> = {};
  for (const strategy of STRATEGIES) {
    const state = await readJsonData<StrategyState>(stateFileName(strategy.id), createInitialStrategyState(VIRTUAL_CAPITAL_YEN));
    state.pendingOrders ??= {}; // 後方互換バックフィル
    states[strategy.id] = state;
  }

  const failures: string[] = [];
  const snapshots: SymbolSnapshot[] = [];
  const currentPricesJpy: Record<string, number> = {};
  const todayOpenLow: Record<string, { open: number; low: number }> = {};

  for (const candidate of config.items) {
    let history: DailyHistory;
    try {
      history = await fetchDailyHistory(candidate.symbol);
    } catch (error) {
      logger.error(`jp-strategy-lab: market data fetch failed for ${candidate.symbol}`, error);
      failures.push(candidate.symbol);
      continue;
    }
    if (history.closes.length < MIN_HISTORY_DAYS) {
      logger.warn(`jp-strategy-lab: not enough daily history for ${candidate.symbol} (${history.closes.length} closes), skipping`);
      continue;
    }
    const snapshot = buildSnapshot(candidate.symbol, today, history);
    snapshots.push(snapshot);
    currentPricesJpy[candidate.symbol] = snapshot.dayClose;
    todayOpenLow[candidate.symbol] = { open: history.opens.at(-1)!, low: history.lows.at(-1)! };
  }

  for (const strategy of STRATEGIES) {
    let state = states[strategy.id]!;
    for (const snapshot of snapshots) {
      const symbol = snapshot.symbol;
      const todayOL = todayOpenLow[symbol]!;
      const pending = state.pendingOrders[symbol];

      let orderStillPending = false;
      if (pending) {
        if (pending.action === 'sell') {
          state = applySell(state, symbol, todayOL.open, today, pending.reason);
          state = clearPendingOrder(state, symbol);
        } else if (pending.action === 'buy' && pending.quantity !== undefined && pending.limitPriceJpy === undefined) {
          state = applyBuy(state, symbol, todayOL.open, pending.quantity, today, pending.reason);
          state = clearPendingOrder(state, symbol);
        } else if (pending.action === 'buy' && pending.quantity !== undefined && pending.limitPriceJpy !== undefined && todayOL.low <= pending.limitPriceJpy) {
          const fillPriceJpy = Math.min(pending.limitPriceJpy, todayOL.open);
          state = applyBuy(state, symbol, fillPriceJpy, pending.quantity, today, pending.reason);
          state = clearPendingOrder(state, symbol);
        } else if (daysSince(pending.queuedDate, today) >= LIMIT_ORDER_EXPIRY_DAYS) {
          state = clearPendingOrder(state, symbol);
        } else {
          orderStillPending = true;
        }
      }

      if (orderStillPending) {
        continue;
      }

      const position = state.positions[symbol];
      const openPositionCount = Object.keys(state.positions).length;
      const signal = strategy.decide(position, snapshot, snapshots, openPositionCount);
      if (signal.action === 'buy' && signal.quantity !== undefined) {
        state = queuePendingOrder(state, symbol, { action: 'buy', quantity: signal.quantity, limitPriceJpy: signal.limitPriceJpy, reason: signal.reason, queuedDate: today });
      } else if (signal.action === 'sell') {
        state = queuePendingOrder(state, symbol, { action: 'sell', reason: signal.reason, queuedDate: today });
      }
    }
    states[strategy.id] = pruneLog(state, today);
  }

  if (dryRun) {
    const summary = STRATEGIES.map((s) => ({
      id: s.id,
      totalEquityJpy: Math.round(calcTotalEquityJpy(states[s.id]!, currentPricesJpy)),
      openPositions: Object.keys(states[s.id]!.positions).length,
      pendingOrders: Object.keys(states[s.id]!.pendingOrders).length,
    }));
    logger.info('Dry run: jp-strategy-lab (state not saved)', { summary, failures, symbolsProcessed: snapshots.length, candidates: config.items.length });
    return;
  }

  for (const strategy of STRATEGIES) {
    let state = states[strategy.id]!;
    state = { ...state, equityHistory: [...state.equityHistory, { date: today, totalEquityJpy: calcTotalEquityJpy(state, currentPricesJpy) }] };
    states[strategy.id] = state;
    await writeJsonData(stateFileName(strategy.id), state);
  }
  logger.info(`jp-strategy-lab: check complete for ${snapshots.length}/${config.items.length} symbols across ${STRATEGIES.length} strategies`);

  const dashboardData = buildDashboardData(STRATEGIES, states, currentPricesJpy, config.items, VIRTUAL_CAPITAL_YEN);
  await writeFile(DASHBOARD_DATA_PATH, `${JSON.stringify(dashboardData, null, 2)}\n`, 'utf-8');
  await writeJsonData<LabMeta>(META_FILE, { lastPublishedAt: now.toISOString(), lastRunDate: today });
  logger.info('jp-strategy-lab: published dashboard update');
}

main().catch(async (error) => {
  logger.error('jp-strategy-lab: fatal error', error);
  process.exitCode = 1;

  const webhookUrl = process.env.DISCORD_WEBHOOK_DAYTRADE;
  if (webhookUrl) {
    await postDiscordAlert(webhookUrl, '日本株戦略ラボ失敗', String((error as Error)?.stack ?? error));
  }
});
