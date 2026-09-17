import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readJsonConfig } from '../../shared/personalConfig.ts';
import { readJsonData, writeJsonData } from '../../shared/dataFile.ts';
import { requireEnv } from '../../shared/env.ts';
import { postDiscordEmbeds, postDiscordAlert } from '../../shared/discordClient.ts';
import { logger } from '../../util/logger.ts';
import { todayJstDateString } from '../../shared/jstDate.ts';
import { fetchDailyHistory, fetchUsdJpyRate } from './marketData.ts';
import { calcRsi14, calcSma, calcVolumeRatio } from '../daytrade-sim/indicators.ts';
import { decideTradeUs } from './rules.ts';
import { applyBuy, applySell, avgEntryPriceUsd, lastTrancheEntryPriceUsd, lastTrancheEntryDate, calcTotalEquityJpy } from './portfolio.ts';
import { buildDaytradeSimUsEmbed, buildAllocationPieEmbedUs } from './format.ts';
import { buildDashboardDataUs } from './dashboard.ts';
import { createInitialUsState } from './types.ts';
import type { DaytradeUsConfig, DaytradeUsState, PendingOrderUs } from './types.ts';

const LOG_RETENTION_DAYS = 90;
const TREND_SMA_PERIOD = 75; // same trend filter/trend-break design as the JP version — see daytrade-sim/rules.ts

// 2026年9月4日追加: 「買いたいけど予算がないからあきらめる、ということが
// 成績の優位差を生むか確認したい」というユーザー要望を受けたプロファイル。
// ルール・候補銘柄・1銘柄あたりの上限（maxPositionYen）はすべて既定プロ
// ファイルと同一のconfig/daytrade-us.jsonを共有し、総予算（virtualCapitalYen）
// だけをconfig/daytrade-us-highbudget.jsonの値で上書きする（daytrade-sim/
// index.tsの--profile=highbudgetと同じ考え方）。
type Profile = 'default' | 'highbudget';

function parseProfile(argv: string[]): Profile {
  const flag = argv.find((arg) => arg.startsWith('--profile='));
  const value = flag?.slice('--profile='.length) ?? 'default';
  if (value !== 'default' && value !== 'highbudget') {
    throw new Error(`daytrade-sim-us: unknown --profile value ${value} (expected 'default' or 'highbudget')`);
  }
  return value;
}

interface HighBudgetProfileConfig {
  note?: string;
  virtualCapitalYen: number;
}

function pruneLog(state: DaytradeUsState, today: string): DaytradeUsState {
  const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const keep = (date: string) => date === today || new Date(date).getTime() >= cutoff;
  return { ...state, log: state.log.filter((e) => keep(e.date)), equityHistory: state.equityHistory.filter((p) => keep(p.date)) };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const profile = parseProfile(process.argv);
  const isHighBudgetProfile = profile === 'highbudget';
  const config = await readJsonConfig<DaytradeUsConfig>('daytrade-us.json');
  const virtualCapitalYen = isHighBudgetProfile ? (await readJsonConfig<HighBudgetProfileConfig>('daytrade-us-highbudget.json')).virtualCapitalYen : config.virtualCapitalYen;
  const dirSuffix = isHighBudgetProfile ? '-highbudget' : '';
  const STATE_FILE = `daytrade-sim-us${dirSuffix}-state.json`;
  const DASHBOARD_DATA_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', `daytrade-sim-us${dirSuffix}`, 'data.json');
  // Scheduled to run shortly after the US regular session closes, which in
  // JST is very early morning the *next* calendar day (e.g. 16:00 ET close
  // -> ~05:00-06:00 JST) — the JST date at run time is used consistently
  // throughout (state, logs, dashboard), same convention as every other
  // feature in this repo, even though it trails the US market's own
  // trading-day-of-record by one JST calendar day.
  const today = todayJstDateString();

  let state = await readJsonData<DaytradeUsState>(STATE_FILE, createInitialUsState(virtualCapitalYen));
  state.pendingOrders ??= {};

  if (state.lastRunDate === today) {
    logger.info(`daytrade-sim-us: already processed ${today}, skipping (state.lastRunDate matches)`);
    return;
  }

  const nameFor = (symbol: string) => config.items.find((i) => i.symbol === symbol)?.name ?? symbol;
  const fxRate = await fetchUsdJpyRate();

  const failures: string[] = [];
  const currentPricesUsd: Record<string, number> = {};
  const logCountBefore = state.log.length;
  const newlyQueued: { symbol: string; order: PendingOrderUs }[] = []; // signals decided this run, not yet filled — reported separately from todaysTrades (what actually settled)

  for (const candidate of config.items) {
    const { symbol } = candidate;
    let history;
    try {
      history = await fetchDailyHistory(symbol);
    } catch (error) {
      logger.error(`daytrade-sim-us: market data fetch failed for ${symbol}`, error);
      failures.push(`${nameFor(symbol)} (${symbol})`);
      continue;
    }

    if (history.closes.length < TREND_SMA_PERIOD + 1) {
      // +1: need both the 75-day SMA window and a distinct previous-close entry before it.
      logger.warn(`daytrade-sim-us: not enough daily history for ${symbol} (${history.closes.length} closes), skipping`);
      continue;
    }

    const dayClose = history.closes.at(-1)!;
    const previousClose = history.closes.at(-2)!;
    currentPricesUsd[symbol] = dayClose;

    // Fill any order queued by yesterday's signal, before evaluating a new
    // one — at today's open, the first price actually tradeable since
    // yesterday's close triggered it (a real order placed after seeing the
    // close can't execute at that already-printed price). Uses today's
    // freshly-fetched fxRate, not the rate from when it was queued.
    const pending = state.pendingOrders[symbol];
    if (pending) {
      const fillPrice = history.opens.at(-1)!;
      if (pending.action === 'buy' && pending.trancheNumber !== undefined) {
        state = applyBuy(state, symbol, fillPrice, fxRate, pending.trancheNumber, config.maxPositionYen, config.marginMultiplier, today, pending.reason);
      } else if (pending.action === 'sell') {
        state = applySell(state, symbol, fillPrice, fxRate, today, pending.reason);
      }
      const remainingPending = { ...state.pendingOrders };
      delete remainingPending[symbol];
      state = { ...state, pendingOrders: remainingPending };
    }

    const dailyMovePct = ((dayClose - previousClose) / previousClose) * 100;
    const rsi14 = calcRsi14(history.closes);
    const volumeRatio = calcVolumeRatio(history.volumes);
    const sma75 = calcSma(history.closes, TREND_SMA_PERIOD);

    const position = state.positions[symbol];
    const hasPosition = Boolean(position);
    const tranchesHeld = (position?.tranches.length ?? 0) as 0 | 1 | 2 | 3;

    const signal = decideTradeUs(
      {
        hasPosition,
        tranchesHeld,
        avgEntryPriceUsd: position ? avgEntryPriceUsd(position) : 0,
        lastTrancheEntryPriceUsd: position ? lastTrancheEntryPriceUsd(position) : 0,
        canPyramidToday: position ? lastTrancheEntryDate(position) !== today : false,
        dailyMovePct,
        dayClose,
        sma75,
        rsi14,
        volumeRatio,
      },
      config.thresholds,
    );

    // Not applied immediately — queued for tomorrow's open (see the
    // pending-fill block above and PendingOrderUs in types.ts).
    if (signal.action === 'buy' && signal.trancheNumber !== undefined) {
      const order: PendingOrderUs = { action: 'buy', trancheNumber: signal.trancheNumber, reason: signal.reason, queuedDate: today };
      state = { ...state, pendingOrders: { ...state.pendingOrders, [symbol]: order } };
      newlyQueued.push({ symbol, order });
    } else if (signal.action === 'sell') {
      const order: PendingOrderUs = { action: 'sell', reason: signal.reason, queuedDate: today };
      state = { ...state, pendingOrders: { ...state.pendingOrders, [symbol]: order } };
      newlyQueued.push({ symbol, order });
    }
  }

  const todaysTrades = state.log.slice(logCountBefore);
  state = { ...state, equityHistory: [...state.equityHistory, { date: today, totalEquityJpy: calcTotalEquityJpy(state, currentPricesUsd, fxRate) }] };

  const profileLabel = isHighBudgetProfile ? `（元本${virtualCapitalYen.toLocaleString('ja-JP')}円）` : undefined;
  const embed = await buildDaytradeSimUsEmbed({ date: today, state, todaysTrades, newlyQueued, currentPricesUsd, currentFxRate: fxRate, nameFor, profileLabel });
  const pieEmbed = await buildAllocationPieEmbedUs(state, currentPricesUsd, fxRate, nameFor, profileLabel);
  const embeds = pieEmbed ? [embed, pieEmbed] : [embed];

  if (failures.length > 0) {
    embed.description = `${embed.description}\n\n取得できなかった銘柄: ${failures.join('・')}`;
  }

  if (dryRun) {
    logger.info('Dry run: daytrade-sim-us embed (not posted, state not saved)', { embeds, todaysTrades, newlyQueued, failures });
    return;
  }

  // Reuses the same Discord webhook as the JP daytrade-sim (distinct embed
  // title/color) rather than requiring a new secret — see README for how to
  // switch to a dedicated webhook if the two should be split later.
  const webhookUrl = requireEnv('DISCORD_WEBHOOK_DAYTRADE');
  await postDiscordEmbeds(webhookUrl, embeds);
  logger.info(`daytrade-sim-us: posted daily report to Discord (${todaysTrades.length} trade(s) today)`);

  state = pruneLog({ ...state, lastRunDate: today }, today);
  await writeJsonData(STATE_FILE, state);

  const dashboardData = buildDashboardDataUs(state, currentPricesUsd, fxRate, nameFor, virtualCapitalYen);
  await writeFile(DASHBOARD_DATA_PATH, `${JSON.stringify(dashboardData, null, 2)}\n`, 'utf-8');
}

main().catch(async (error) => {
  logger.error('daytrade-sim-us: fatal error', error);
  process.exitCode = 1;

  const webhookUrl = process.env.DISCORD_WEBHOOK_DAYTRADE;
  if (webhookUrl) {
    await postDiscordAlert(webhookUrl, '米国株デイトレSim失敗', String((error as Error)?.stack ?? error));
  }
});
