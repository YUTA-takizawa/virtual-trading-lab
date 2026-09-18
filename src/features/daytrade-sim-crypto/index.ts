import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readJsonConfig } from '../../shared/personalConfig.ts';
import { readJsonData, writeJsonData } from '../../shared/dataFile.ts';
import { requireEnv } from '../../shared/env.ts';
import { postDiscordEmbeds, postDiscordAlert, joinWithinFieldLimit } from '../../shared/discordClient.ts';
import { logger } from '../../util/logger.ts';
import { todayJstDateString } from '../../shared/jstDate.ts';
import { fetchDailyHistory } from './marketData.ts';
import { calcRsi14, calcSma, calcVolumeRatio } from '../daytrade-sim/indicators.ts';
import { decideTradeCrypto } from './rules.ts';
import { applyBuy, applySell, avgEntryPriceJpy, lastTrancheEntryPriceJpy, lastTrancheEntryDate, calcTotalEquityJpy } from './portfolio.ts';
import { buildDaytradeSimCryptoEmbed, buildAllocationPieEmbedCrypto } from './format.ts';
import { buildDashboardDataCrypto } from './dashboard.ts';
import { createInitialCryptoState } from './types.ts';
import type { DaytradeCryptoConfig, DaytradeCryptoSession, DaytradeCryptoState } from './types.ts';

const LOG_RETENTION_DAYS = 90;
const TREND_SMA_PERIOD = 75; // same trend filter/trend-break design as the JP/US versions

// 2026年9月4日追加: 「買いたいけど予算がないからあきらめる、ということが
// 成績の優位差を生むか確認したい」というユーザー要望を受けたプロファイル。
// ルール・候補銘柄・1銘柄あたりの上限（maxPositionYen）はすべて既定プロ
// ファイルと同一のconfig/daytrade-crypto.jsonを共有し、総予算
// （virtualCapitalYen）だけをconfig/daytrade-crypto-highbudget.jsonの値で
// 上書きする（daytrade-sim/index.tsの--profile=highbudgetと同じ考え方）。
type Profile = 'default' | 'highbudget';

function parseProfile(argv: string[]): Profile {
  const flag = argv.find((arg) => arg.startsWith('--profile='));
  const value = flag?.slice('--profile='.length) ?? 'default';
  if (value !== 'default' && value !== 'highbudget') {
    throw new Error(`daytrade-sim-crypto: unknown --profile value ${value} (expected 'default' or 'highbudget')`);
  }
  return value;
}

interface HighBudgetProfileConfig {
  note?: string;
  virtualCapitalYen: number;
}

// Checks run every 15 minutes (crypto trades 24/7, so there's no "session
// close" to wait for), but posting to Discord every 15 minutes would be
// spam. Gate notifications on elapsed time since the last one instead of a
// fixed wall-clock schedule (e.g. "07:00/23:00 JST") — GitHub Actions cron
// has been observed to delay by many hours (see daytrade-sim.yml's history),
// and a fixed-time gate would risk losing that day's notification entirely
// if the delay straddles it. An elapsed-time gate always catches up on the
// very next check instead.
// 8時間は24を割り切るため、通知時刻は日々ドリフトせず一定のリズム（例:
// 6時→14時→22時→翌6時…）に収束する。11時間だった頃は24を割り切れず、
// 通知のたびに時刻が2時間ずつ前倒しになっていた（2026年8月30日、8時間に変更）。
const NOTIFY_INTERVAL_HOURS = 8;

// Webダッシュボードは「細かく見たほうが楽しい」というユーザー要望
// （2026年8月31日）でDiscord通知より高頻度の1時間おきに公開する。Discord
// 通知の間引き（スパム防止）とダッシュボードの鮮度は別の関心事なので、
// 別々のタイムスタンプ（lastNotifiedAt / lastDashboardPublishedAt）で
// 独立に間引く。
const DASHBOARD_PUBLISH_INTERVAL_HOURS = 1;

function jstHour(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
}

function pruneLog(state: DaytradeCryptoState, today: string): DaytradeCryptoState {
  const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const keep = (date: string) => date === today || new Date(date).getTime() >= cutoff;
  return {
    ...state,
    log: state.log.filter((e) => keep(e.date)),
    equityHistory: state.equityHistory.filter((p) => keep(p.date)),
    dashboardEquityHistory: state.dashboardEquityHistory.filter((p) => keep(p.date)),
  };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const forceNotify = process.argv.includes('--notify'); // manual override for testing the notification path without waiting out the interval
  const profile = parseProfile(process.argv);
  const isHighBudgetProfile = profile === 'highbudget';
  const config = await readJsonConfig<DaytradeCryptoConfig>('daytrade-crypto.json');
  const virtualCapitalYen = isHighBudgetProfile ? (await readJsonConfig<HighBudgetProfileConfig>('daytrade-crypto-highbudget.json')).virtualCapitalYen : config.virtualCapitalYen;
  const dirSuffix = isHighBudgetProfile ? '-highbudget' : '';
  const STATE_FILE = `daytrade-sim-crypto${dirSuffix}-state.json`;
  const DASHBOARD_DATA_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', `daytrade-sim-crypto${dirSuffix}`, 'data.json');
  const now = new Date();
  const today = todayJstDateString(now);

  let state = await readJsonData<DaytradeCryptoState>(STATE_FILE, createInitialCryptoState(virtualCapitalYen));

  const nameFor = (symbol: string) => config.items.find((i) => i.symbol === symbol)?.name ?? symbol;

  const failures: string[] = [];
  const currentPricesJpy: Record<string, number> = {};

  // Every invocation checks and trades, regardless of whether it will also
  // notify this time — that's the whole point of running every 15 minutes
  // instead of twice a day.
  for (const candidate of config.items) {
    const { symbol } = candidate;
    let history;
    try {
      history = await fetchDailyHistory(symbol);
    } catch (error) {
      logger.error(`daytrade-sim-crypto: market data fetch failed for ${symbol}`, error);
      failures.push(`${nameFor(symbol)} (${symbol})`);
      continue;
    }

    if (history.closes.length < TREND_SMA_PERIOD + 1) {
      logger.warn(`daytrade-sim-crypto: not enough daily history for ${symbol} (${history.closes.length} closes), skipping`);
      continue;
    }

    const dayClose = history.closes.at(-1)!;
    const previousClose = history.closes.at(-2)!;
    currentPricesJpy[symbol] = dayClose;

    const dailyMovePct = ((dayClose - previousClose) / previousClose) * 100;
    const rsi14 = calcRsi14(history.closes);
    const volumeRatio = calcVolumeRatio(history.volumes);
    const sma75 = calcSma(history.closes, TREND_SMA_PERIOD);

    const position = state.positions[symbol];
    const hasPosition = Boolean(position);
    const tranchesHeld = (position?.tranches.length ?? 0) as 0 | 1 | 2 | 3;

    const signal = decideTradeCrypto(
      {
        hasPosition,
        tranchesHeld,
        avgEntryPriceJpy: position ? avgEntryPriceJpy(position) : 0,
        lastTrancheEntryPriceJpy: position ? lastTrancheEntryPriceJpy(position) : 0,
        canPyramidToday: position ? lastTrancheEntryDate(position) !== today : false,
        dailyMovePct,
        dayClose,
        sma75,
        rsi14,
        volumeRatio,
      },
      config.thresholds,
    );

    if (signal.action === 'buy' && signal.trancheNumber !== undefined) {
      state = applyBuy(state, symbol, dayClose, signal.trancheNumber, config.maxPositionYen, config.marginMultiplier, today, signal.reason);
    } else if (signal.action === 'sell') {
      state = applySell(state, symbol, dayClose, today, signal.reason);
    }
  }

  const hoursSinceLastNotified = state.lastNotifiedAt ? (now.getTime() - new Date(state.lastNotifiedAt).getTime()) / (60 * 60 * 1000) : Infinity;
  const shouldNotify = forceNotify || hoursSinceLastNotified >= NOTIFY_INTERVAL_HOURS;
  const hoursSinceDashboardPublish = state.lastDashboardPublishedAt ? (now.getTime() - new Date(state.lastDashboardPublishedAt).getTime()) / (60 * 60 * 1000) : Infinity;
  const shouldPublishDashboard = hoursSinceDashboardPublish >= DASHBOARD_PUBLISH_INTERVAL_HOURS;

  // Cosmetic label only (which half of the day this notification landed in)
  // — checks run continuously regardless, this doesn't gate anything.
  const session: DaytradeCryptoSession = jstHour(now) < 15 ? 'morning' : 'night';

  if (dryRun) {
    const newTrades = state.log.slice(state.lastNotifiedLogCount);
    logger.info('Dry run: daytrade-sim-crypto (state not saved)', { shouldNotify, hoursSinceLastNotified, shouldPublishDashboard, hoursSinceDashboardPublish, newTrades, failures });
    return;
  }

  if (shouldNotify) {
    const newTrades = state.log.slice(state.lastNotifiedLogCount);
    state = { ...state, equityHistory: [...state.equityHistory, { date: today, session, totalEquityJpy: calcTotalEquityJpy(state, currentPricesJpy) }] };

    const profileLabel = isHighBudgetProfile ? `（元本${virtualCapitalYen.toLocaleString('ja-JP')}円）` : undefined;
    const embed = await buildDaytradeSimCryptoEmbed({ date: today, session, state, newTrades, currentPricesJpy, nameFor, profileLabel });
    const pieEmbed = await buildAllocationPieEmbedCrypto(state, currentPricesJpy, nameFor, profileLabel);
    const embeds = pieEmbed ? [embed, pieEmbed] : [embed];
    if (failures.length > 0) {
      // Discord's embed.description caps out at 4096 chars — a near-total
      // market-data outage can produce hundreds of failed symbols, which
      // blew past that limit and crashed the whole report with a 400
      // (observed 2026-09-17, JP version — see daytrade-sim/index.ts).
      const prefix = '\n\n取得できなかった銘柄: ';
      const budget = Math.max(4096 - (embed.description ?? '').length - prefix.length, 0);
      embed.description = `${embed.description}${prefix}${joinWithinFieldLimit(failures, budget, '・')}`;
    }

    // Reuses the same Discord webhook as the JP/US daytrade-sim modules
    // (distinct embed title/color) rather than requiring a new secret — see
    // README for how to switch to a dedicated webhook if this should split later.
    const webhookUrl = requireEnv('DISCORD_WEBHOOK_DAYTRADE');
    await postDiscordEmbeds(webhookUrl, embeds);
    logger.info(`daytrade-sim-crypto: posted ${session} report to Discord (${newTrades.length} trade(s) since last notification)`);

    state = { ...state, lastNotifiedAt: now.toISOString(), lastNotifiedLogCount: state.log.length };
  }

  if (shouldPublishDashboard) {
    state = { ...state, dashboardEquityHistory: [...state.dashboardEquityHistory, { date: today, session, totalEquityJpy: calcTotalEquityJpy(state, currentPricesJpy) }], lastDashboardPublishedAt: now.toISOString() };
    const dashboardData = buildDashboardDataCrypto(state, currentPricesJpy, nameFor, virtualCapitalYen);
    await writeFile(DASHBOARD_DATA_PATH, `${JSON.stringify(dashboardData, null, 2)}\n`, 'utf-8');
    logger.info('daytrade-sim-crypto: published dashboard update');
  }

  state = pruneLog(state, today);
  await writeJsonData(STATE_FILE, state);
}

main().catch(async (error) => {
  logger.error('daytrade-sim-crypto: fatal error', error);
  process.exitCode = 1;

  const webhookUrl = process.env.DISCORD_WEBHOOK_DAYTRADE;
  if (webhookUrl) {
    await postDiscordAlert(webhookUrl, '暗号資産デイトレSim失敗', String((error as Error)?.stack ?? error));
  }
});
