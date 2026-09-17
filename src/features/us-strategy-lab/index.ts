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
import {
  calcRsi14,
  calcSma,
  calcVolumeRatio,
  calcBollingerBands,
  calcHighestHigh,
  calcLowestLow,
  calcReturnPct,
  calcMacd,
  calcAtr,
  calcStochastic,
  calcVwap,
  calcIchimokuTk,
  calcConsecutiveDownDays,
} from './indicators.ts';
import { applyBuy, applySell, calcTotalEquityUsd } from './portfolio.ts';
import { createInitialStrategyState } from './types.ts';
import type { LabMeta, PendingOrderLab, StrategyState, SymbolSnapshot } from './types.ts';
import { STRATEGIES } from './strategies/index.ts';
import { buildDashboardData } from './dashboard.ts';
import type { DaytradeUsConfig } from '../daytrade-sim-us/types.ts';

// 各戦略ごとに別会計で仮想元本$10,000（ユーザー指示「全部別会計で」を
// 暗号資産版から踏襲、2026年9月1日）。
const VIRTUAL_CAPITAL_USD = 10_000;
// 200日SMA・200日高値戦略に必要な最小営業日数（200 + 前日分の200日SMAを
// 計算するための+1）。fetchDailyHistoryの取得期間を1年に延長したのは
// このため（src/features/daytrade-sim/marketData.ts参照）。
const MIN_HISTORY_DAYS = 201;
const LOG_RETENTION_DAYS = 90;
// 指値が刺さらないまま放置されるのを防ぐ有効期限（約2週間の実行回数分）。
// 現実の指値・逆指値注文にも期限があるのと同じ考え方（2026年9月1日追加）。
const LIMIT_ORDER_EXPIRY_DAYS = 10;

const DASHBOARD_DATA_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'us-strategy-lab', 'data.json');
const META_FILE = 'us-strategy-lab-meta.json';

function stateFileName(strategyId: string): string {
  return `us-strategy-lab-${strategyId}-state.json`;
}

function buildSnapshot(symbol: string, date: string, history: DailyHistory): SymbolSnapshot {
  const { opens, highs, lows, closes, volumes } = history;
  const dayClose = closes.at(-1)!;
  const dayOpen = opens.at(-1)!;
  const previousClose = closes.at(-2)!;
  const bb = calcBollingerBands(closes, 20, 2);
  const prevCloses = closes.slice(0, -1);
  const prevHighs = highs.slice(0, -1);
  const prevLows = lows.slice(0, -1);

  const macd = calcMacd(closes);
  const prevMacd = calcMacd(prevCloses);
  const tk = calcIchimokuTk(highs, lows);
  const prevTk = calcIchimokuTk(prevHighs, prevLows);
  const stoch = calcStochastic(highs, lows, closes);
  const priorCloses = closes.slice(0, -10);

  return {
    symbol,
    date,
    dayClose,
    dayOpen,
    prevClose: previousClose,
    dailyMovePct: ((dayClose - previousClose) / previousClose) * 100,
    gapPct: ((dayOpen - previousClose) / previousClose) * 100,
    rsi14: calcRsi14(closes),
    rsi14Prior: calcRsi14(priorCloses),
    closePrior: priorCloses.at(-1)!,
    volumeRatio: calcVolumeRatio(volumes),
    consecutiveDownDays: calcConsecutiveDownDays(closes),

    sma10: calcSma(closes, 10),
    prevSma10: calcSma(prevCloses, 10),
    sma25: calcSma(closes, 25),
    prevSma25: calcSma(prevCloses, 25),
    sma50: calcSma(closes, 50),
    prevSma50: calcSma(prevCloses, 50),
    sma75: calcSma(closes, 75),
    prevSma75: calcSma(prevCloses, 75),
    sma200: calcSma(closes, 200),
    prevSma200: calcSma(prevCloses, 200),

    bollingerMid: bb.mid,
    bollingerUpper: bb.upper,
    bollingerLower: bb.lower,
    highestHigh20: calcHighestHigh(highs, 20),
    lowestLow20: calcLowestLow(lows, 20),
    highestHigh200: calcHighestHigh(highs, 200),
    return20dPct: calcReturnPct(closes, 20),

    macd: macd.macd,
    macdSignal: macd.signal,
    prevMacd: prevMacd.macd,
    prevMacdSignal: prevMacd.signal,
    tenkanSen: tk.tenkanSen,
    kijunSen: tk.kijunSen,
    prevTenkanSen: prevTk.tenkanSen,
    prevKijunSen: prevTk.kijunSen,
    stochK: stoch.k,
    stochD: stoch.d,
    atr14: calcAtr(highs, lows, closes),
    vwap20: calcVwap(closes, volumes, 20),
    dayOfWeek: new Date(date).getUTCDay(),
  };
}

function pruneLog(state: StrategyState, today: string): StrategyState {
  const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const keep = (date: string) => date === today || new Date(date).getTime() >= cutoff;
  return { ...state, log: state.log.filter((e) => keep(e.date)), equityHistory: state.equityHistory.filter((p) => keep(p.date)) };
}

function daysSince(dateStr: string, today: string): number {
  return (new Date(today).getTime() - new Date(dateStr).getTime()) / (24 * 60 * 60 * 1000);
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
  // config/daytrade-us.jsonの候補122銘柄をそのまま流用する（daytrade-sim-us
  // 本体と同一条件で比較する、というこの実験の前提上、候補リストを別途持つと
  // 二重管理になる）。
  const config = await readJsonConfig<DaytradeUsConfig>('daytrade-us.json');
  const now = new Date();
  const today = todayJstDateString(now);

  const meta = await readJsonData<LabMeta>(META_FILE, { lastPublishedAt: null, lastRunDate: null });
  if (meta.lastRunDate === today && !dryRun) {
    // GitHub Actionsのschedule遅延対策として併用しているWindows Task
    // Schedulerと、GitHub自身のcronが同日に重複発火した場合のガード
    // （daytrade-sim/daytrade-sim-usのlastRunDateと同じ考え方）。
    logger.info(`us-strategy-lab: already ran today (${today}), skipping duplicate trigger`);
    return;
  }

  const states: Record<string, StrategyState> = {};
  for (const strategy of STRATEGIES) {
    const state = await readJsonData<StrategyState>(stateFileName(strategy.id), createInitialStrategyState(VIRTUAL_CAPITAL_USD));
    // 2026年9月1日の指値/成行PendingOrder化より前に書かれたstateファイルには
    // pendingOrdersフィールドが存在しない。既存の実運用データを失わずに移行
    // するための後方互換バックフィル（日本株版・米国株版本体のpendingOrders
    // 導入時と同じ手当て）。
    state.pendingOrders ??= {};
    states[strategy.id] = state;
  }

  const failures: string[] = [];
  const snapshots: SymbolSnapshot[] = [];
  const currentPricesUsd: Record<string, number> = {};
  // 前回発注した指値/成行注文を「今日」約定させる際に使う、今日の始値・安値
  // （2026年9月1日追加、PendingOrderLab参照）。
  const todayOpenLow: Record<string, { open: number; low: number }> = {};

  for (const candidate of config.items) {
    let history: DailyHistory;
    try {
      history = await fetchDailyHistory(candidate.symbol);
    } catch (error) {
      logger.error(`us-strategy-lab: market data fetch failed for ${candidate.symbol}`, error);
      failures.push(candidate.symbol);
      continue;
    }
    if (history.closes.length < MIN_HISTORY_DAYS) {
      logger.warn(`us-strategy-lab: not enough daily history for ${candidate.symbol} (${history.closes.length} closes), skipping`);
      continue;
    }
    const snapshot = buildSnapshot(candidate.symbol, today, history);
    snapshots.push(snapshot);
    currentPricesUsd[candidate.symbol] = snapshot.dayClose;
    todayOpenLow[candidate.symbol] = { open: history.opens.at(-1)!, low: history.lows.at(-1)! };
  }

  // 全30戦略・全候補銘柄について判定。各戦略は自分の状態にしか影響しない
  // （別会計）ため、戦略間の処理順は結果に影響しない。まず前回発注した
  // pendingOrdersを今日の始値/安値で約定判定してから、新しいシグナルを
  // 判定して発注する——判断に使った値段でその場で即約定させない、という
  // 現実的な約定タイミングの原則（詳細はtypes.tsのPendingOrderLabコメント参照）。
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
        } else if (pending.limitPriceUsd === undefined) {
          // 成行: 翌営業日の始値で無条件約定。
          state = applyBuy(state, symbol, todayOL.open, pending.budgetUsd!, today, pending.reason);
          state = clearPendingOrder(state, symbol);
        } else if (todayOL.low <= pending.limitPriceUsd) {
          // 指値: 安値が指値以下まで届いた回のみ約定。始値がさらに指値より
          // 低ければ、実際の指値注文と同じくより有利なその始値で約定する。
          const fillPriceUsd = Math.min(pending.limitPriceUsd, todayOL.open);
          state = applyBuy(state, symbol, fillPriceUsd, pending.budgetUsd!, today, pending.reason);
          state = clearPendingOrder(state, symbol);
        } else if (daysSince(pending.queuedDate, today) >= LIMIT_ORDER_EXPIRY_DAYS) {
          // 指値が長期間刺さらなかったため失効させる（現実の指値注文にも期限がある）。
          state = clearPendingOrder(state, symbol);
        } else {
          orderStillPending = true;
        }
      }

      if (orderStillPending) {
        continue; // 発注済みの指値がまだ生きているため、新しい判断はしない
      }

      const position = state.positions[symbol];
      const signal = strategy.decide(position, snapshot, snapshots);
      if (signal.action === 'buy' && signal.budgetUsd !== undefined) {
        state = queuePendingOrder(state, symbol, { action: 'buy', budgetUsd: signal.budgetUsd, limitPriceUsd: signal.limitPriceUsd, reason: signal.reason, queuedDate: today });
      } else if (signal.action === 'sell') {
        state = queuePendingOrder(state, symbol, { action: 'sell', reason: signal.reason, queuedDate: today });
      }
    }
    states[strategy.id] = pruneLog(state, today);
  }

  if (dryRun) {
    const summary = STRATEGIES.map((s) => ({
      id: s.id,
      totalEquityUsd: Math.round(calcTotalEquityUsd(states[s.id]!, currentPricesUsd) * 100) / 100,
      pendingOrders: Object.keys(states[s.id]!.pendingOrders).length,
    }));
    logger.info('Dry run: us-strategy-lab (state not saved)', { summary, failures, symbolsProcessed: snapshots.length, candidates: config.items.length });
    return;
  }

  for (const strategy of STRATEGIES) {
    let state = states[strategy.id]!;
    state = { ...state, equityHistory: [...state.equityHistory, { date: today, totalEquityUsd: calcTotalEquityUsd(state, currentPricesUsd) }] };
    states[strategy.id] = state;
    await writeJsonData(stateFileName(strategy.id), state);
  }
  logger.info(`us-strategy-lab: check complete for ${snapshots.length}/${config.items.length} symbols across ${STRATEGIES.length} strategies`);

  const dashboardData = buildDashboardData(STRATEGIES, states, currentPricesUsd, config.items, VIRTUAL_CAPITAL_USD);
  await writeFile(DASHBOARD_DATA_PATH, `${JSON.stringify(dashboardData, null, 2)}\n`, 'utf-8');
  await writeJsonData<LabMeta>(META_FILE, { lastPublishedAt: now.toISOString(), lastRunDate: today });
  logger.info('us-strategy-lab: published dashboard update');
}

main().catch(async (error) => {
  logger.error('us-strategy-lab: fatal error', error);
  process.exitCode = 1;

  const webhookUrl = process.env.DISCORD_WEBHOOK_DAYTRADE;
  if (webhookUrl) {
    await postDiscordAlert(webhookUrl, '米国株戦略ラボ失敗', String((error as Error)?.stack ?? error));
  }
});
