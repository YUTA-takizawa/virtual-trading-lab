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
} from './indicators.ts';
import { applyBuy, applySell, calcTotalEquityJpy } from './portfolio.ts';
import { createInitialStrategyState } from './types.ts';
import type { LabMeta, StrategyState, SymbolSnapshot } from './types.ts';
import { STRATEGIES } from './strategies/index.ts';
import { buildDashboardData } from './dashboard.ts';
import type { DaytradeCryptoConfig } from '../daytrade-sim-crypto/types.ts';

// 各戦略ごとに別会計で仮想元本100万円（ユーザー指示、2026年8月31日）。
const VIRTUAL_CAPITAL_YEN = 1_000_000;
const MIN_HISTORY_DAYS = 76; // 75日SMA + 前日分のSMAを計算するのに必要な最小日数
const LOG_RETENTION_DAYS = 90;

// ダッシュボードのみで比較する方針（Discord通知なし、2026年8月31日ユーザー
// 指示）のため、チェック自体は15分おきに毎回行うが、ダッシュボード出力
// （gitコミット・Cloudflareデプロイ）は間引く。当初はdaytrade-sim-cryptoの
// NOTIFY_INTERVAL_HOURSに合わせて8時間だったが、「細かく見たほうが楽しい」
// というユーザー要望（2026年8月31日）を受けて1時間に短縮した。
const PUBLISH_INTERVAL_HOURS = 1;

const DASHBOARD_DATA_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'crypto-strategy-lab', 'data.json');
const META_FILE = 'crypto-strategy-lab-meta.json';

function stateFileName(strategyId: string): string {
  return `crypto-strategy-lab-${strategyId}-state.json`;
}

function buildSnapshot(symbol: string, date: string, history: DailyHistory): SymbolSnapshot {
  const { highs, lows, closes, volumes } = history;
  const dayClose = closes.at(-1)!;
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
    dailyMovePct: ((dayClose - previousClose) / previousClose) * 100,
    rsi14: calcRsi14(closes),
    volumeRatio: calcVolumeRatio(volumes),
    sma25: calcSma(closes, 25),
    sma75: calcSma(closes, 75),
    prevSma25: calcSma(prevCloses, 25),
    prevSma75: calcSma(prevCloses, 75),
    bollingerMid: bb.mid,
    bollingerUpper: bb.upper,
    bollingerLower: bb.lower,
    highestHigh20: calcHighestHigh(highs, 20),
    lowestLow20: calcLowestLow(lows, 20),
    return20dPct: calcReturnPct(closes, 20),

    sma10: calcSma(closes, 10),
    prevSma10: calcSma(prevCloses, 10),
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
    rsi14Prior: calcRsi14(priorCloses),
    closePrior: priorCloses.at(-1)!,
    dayOfWeek: new Date(date).getUTCDay(), // dateはYYYY-MM-DD文字列なのでUTC解釈で曜日がズレない
  };
}

function pruneLog(state: StrategyState, today: string): StrategyState {
  const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const keep = (date: string) => date === today || new Date(date).getTime() >= cutoff;
  return { ...state, log: state.log.filter((e) => keep(e.date)), equityHistory: state.equityHistory.filter((p) => keep(p.date)) };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  // config/daytrade-crypto.jsonの候補16銘柄をそのまま流用する（同一条件で
  // 比較する、というこの実験の前提上、候補リストを別途持つと二重管理になる）。
  const config = await readJsonConfig<DaytradeCryptoConfig>('daytrade-crypto.json');
  const now = new Date();
  const today = todayJstDateString(now);

  const states: Record<string, StrategyState> = {};
  for (const strategy of STRATEGIES) {
    states[strategy.id] = await readJsonData<StrategyState>(stateFileName(strategy.id), createInitialStrategyState(VIRTUAL_CAPITAL_YEN));
  }

  const failures: string[] = [];
  const snapshots: SymbolSnapshot[] = [];
  const currentPricesJpy: Record<string, number> = {};

  for (const candidate of config.items) {
    let history: DailyHistory;
    try {
      history = await fetchDailyHistory(candidate.symbol);
    } catch (error) {
      logger.error(`crypto-strategy-lab: market data fetch failed for ${candidate.symbol}`, error);
      failures.push(candidate.symbol);
      continue;
    }
    if (history.closes.length < MIN_HISTORY_DAYS) {
      logger.warn(`crypto-strategy-lab: not enough daily history for ${candidate.symbol} (${history.closes.length} closes), skipping`);
      continue;
    }
    const snapshot = buildSnapshot(candidate.symbol, today, history);
    snapshots.push(snapshot);
    currentPricesJpy[candidate.symbol] = snapshot.dayClose;
  }

  // 全10戦略・全16銘柄について判定。各戦略は自分の状態にしか影響しない
  // （別会計）ため、戦略間の処理順は結果に影響しない。
  for (const strategy of STRATEGIES) {
    let state = states[strategy.id]!;
    for (const snapshot of snapshots) {
      const position = state.positions[snapshot.symbol];
      const signal = strategy.decide(position, snapshot, snapshots);
      if (signal.action === 'buy' && signal.budgetJpy !== undefined) {
        state = applyBuy(state, snapshot.symbol, snapshot.dayClose, signal.budgetJpy, today, signal.reason);
      } else if (signal.action === 'sell') {
        state = applySell(state, snapshot.symbol, snapshot.dayClose, today, signal.reason);
      }
    }
    states[strategy.id] = pruneLog(state, today);
  }

  const meta = await readJsonData<LabMeta>(META_FILE, { lastPublishedAt: null });
  const hoursSincePublished = meta.lastPublishedAt ? (now.getTime() - new Date(meta.lastPublishedAt).getTime()) / (60 * 60 * 1000) : Infinity;
  const shouldPublish = hoursSincePublished >= PUBLISH_INTERVAL_HOURS;

  if (dryRun) {
    const summary = STRATEGIES.map((s) => ({ id: s.id, totalEquityJpy: Math.round(calcTotalEquityJpy(states[s.id]!, currentPricesJpy)) }));
    logger.info('Dry run: crypto-strategy-lab (state not saved)', { summary, shouldPublish, hoursSincePublished, failures });
    return;
  }

  for (const strategy of STRATEGIES) {
    await writeJsonData(stateFileName(strategy.id), states[strategy.id]!);
  }
  logger.info(`crypto-strategy-lab: check complete for ${snapshots.length}/${config.items.length} symbols across ${STRATEGIES.length} strategies`);

  if (!shouldPublish) {
    return;
  }

  for (const strategy of STRATEGIES) {
    let state = states[strategy.id]!;
    state = { ...state, equityHistory: [...state.equityHistory, { date: today, totalEquityJpy: calcTotalEquityJpy(state, currentPricesJpy) }] };
    states[strategy.id] = state;
    await writeJsonData(stateFileName(strategy.id), state);
  }

  const dashboardData = buildDashboardData(STRATEGIES, states, currentPricesJpy, config.items, VIRTUAL_CAPITAL_YEN);
  await writeFile(DASHBOARD_DATA_PATH, `${JSON.stringify(dashboardData, null, 2)}\n`, 'utf-8');
  await writeJsonData<LabMeta>(META_FILE, { lastPublishedAt: now.toISOString() });
  logger.info('crypto-strategy-lab: published dashboard update');
}

main().catch(async (error) => {
  logger.error('crypto-strategy-lab: fatal error', error);
  process.exitCode = 1;

  // ダッシュボードのみで比較する方針だが、致命的なエラーだけは既存の
  // Discord Webhookで別枠として知らせる（ルーチンの成績通知とは別物）。
  const webhookUrl = process.env.DISCORD_WEBHOOK_DAYTRADE;
  if (webhookUrl) {
    await postDiscordAlert(webhookUrl, '暗号資産戦略ラボ失敗', String((error as Error)?.stack ?? error));
  }
});
