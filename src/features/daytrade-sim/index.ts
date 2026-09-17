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
import { fetchIntradaySnapshot, fetchDailyHistory, type IntradaySnapshot, type DailyHistory } from './marketData.ts';
import { fetchFundamentalsPage, parseValuation, parseLatestEarningsDate } from './fundamentals.ts';
import { calcRsi14, calcSma, calcVolumeRatio } from './indicators.ts';
import { decideTrade } from './rules.ts';
import { applyBuy, applySell, applyDailyCommission, avgEntryPrice, lastTrancheEntryPrice, lastTrancheEntryDate, calcDailyCommission, calcTotalEquity, exceedsMaxPosition, LOT_SIZE } from './portfolio.ts';
import { buildDaytradeSimEmbed, buildAllocationPieEmbed } from './format.ts';
import { buildDashboardData } from './dashboard.ts';
import { createInitialState } from './types.ts';
import type { DaytradeConfig, DaytradeSession, DaytradeState, PendingOrder } from './types.ts';

const LOG_RETENTION_DAYS = 90;
const TREND_SMA_PERIOD = 75; // trend filter / trend-break exit — see rules.ts
// 指値（tranche1の打診買い）が刺さらないまま放置されるのを防ぐ有効期限
// （約2週間分の営業日）。現実の指値注文にも期限があるのと同じ考え方
// （2026年9月1日追加、src/features/us-strategy-lab/index.tsと同じ定数）。
const LIMIT_ORDER_EXPIRY_DAYS = 10;

function daysSince(dateStr: string, today: string): number {
  return (new Date(today).getTime() - new Date(dateStr).getTime()) / (24 * 60 * 60 * 1000);
}

function parseSession(argv: string[]): DaytradeSession {
  const flag = argv.find((arg) => arg.startsWith('--session='));
  const value = flag?.slice('--session='.length);
  if (value !== 'morning' && value !== 'afternoon') {
    throw new Error(`daytrade-sim: missing/invalid --session flag (expected --session=morning or --session=afternoon, got ${value ?? 'nothing'})`);
  }
  return value;
}

// 2026年9月3日追加: ルール・候補銘柄・元本はすべて既定プロファイルと共通の
// まま、「1単元（100株）の取得コストが一定額未満の銘柄だけを新規建て対象と
// する」という追加フィルタだけを持つ別プロファイル（ユーザー要望「日本株新
// 戦略追加、ルールはすべて同じ、異なるのは銘柄で1単元取得するのが10万円未満
// の株だけをピックアップする」）。rules.tsを複製せず、ロジックを完全に共有
// したまま候補を絞り込むことで、2つのプロファイルの判断基準が将来ズレる
// リスクをなくしている。state・ダッシュボード・Discord embedタイトルだけを
// プロファイルごとに分ける。
// 2026年9月4日追加: highbudgetは「買いたいけど予算がないからあきらめる、が
// 成績の優位差を生むか確認したい」というユーザー要望を受けたプロファイル。
// ルール・候補銘柄・1銘柄あたりの上限（maxPositionYen）はすべて既定プロ
// ファイルと同一、総予算（virtualCapitalYen）だけを引き上げる。
type Profile = 'default' | 'cheap' | 'highbudget';

function parseProfile(argv: string[]): Profile {
  const flag = argv.find((arg) => arg.startsWith('--profile='));
  const value = flag?.slice('--profile='.length) ?? 'default';
  if (value !== 'default' && value !== 'cheap' && value !== 'highbudget') {
    throw new Error(`daytrade-sim: unknown --profile value ${value} (expected 'default', 'cheap', or 'highbudget')`);
  }
  return value;
}

interface CheapProfileConfig {
  note?: string;
  maxUnitCostYen: number;
}

interface HighBudgetProfileConfig {
  note?: string;
  virtualCapitalYen: number;
}

// TSE trades 9:00-15:30 JST — a morning/afternoon report generated outside
// this window (with a generous buffer) can only mean the triggering cron was
// delayed badly enough that todayJstDateString() rolled over the JST calendar
// date mid-delay. Seen for real on 2026-08-27: the 06:35 UTC (afternoon) cron
// fired 11+ hours late at 02:52 JST the next day, which passed the
// lastRunDate/lastRunSession guard (today had changed) and wrote a phantom
// "2026-08-28 afternoon" equity-curve point with no real trading behind it.
// Rather than trying to guess the "right" date, just skip and alert — same
// philosophy as watchdog-daytrade-sim.ts's "don't auto-retry, let a human see it".
const IMPLAUSIBLE_HOUR_START_JST = 21;
const IMPLAUSIBLE_HOUR_END_JST = 8;

function jstHour(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
}

function isImplausibleRunTime(hour: number): boolean {
  return hour >= IMPLAUSIBLE_HOUR_START_JST || hour < IMPLAUSIBLE_HOUR_END_JST;
}

function pruneLog(state: DaytradeState, today: string): DaytradeState {
  const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const keep = (date: string) => date === today || new Date(date).getTime() >= cutoff;
  return { ...state, log: state.log.filter((entry) => keep(entry.date)), equityHistory: state.equityHistory.filter((point) => keep(point.date)) };
}

interface Fundamentals {
  per?: number;
  pbr?: number;
  earningsAnnouncedToday: boolean;
}

/**
 * Fundamentals (PER/PBR, latest earnings date) come from a scraped public
 * page rather than an API (see fundamentals.ts) and are treated as
 * fail-open: a fetch/parse failure here must never block the rest of the
 * pipeline for a symbol, so it's wrapped separately from the market-data
 * fetch and just degrades to "unknown" (rules.ts treats undefined
 * per/pbr as passing the filter, and false earningsAnnouncedToday as normal).
 */
async function fetchFundamentals(symbol: string, today: string): Promise<Fundamentals> {
  try {
    const html = await fetchFundamentalsPage(symbol);
    const { per, pbr } = parseValuation(html);
    const earningsAnnouncedToday = parseLatestEarningsDate(html) === today;
    return { per, pbr, earningsAnnouncedToday };
  } catch (error) {
    logger.warn(`daytrade-sim: fundamentals fetch failed for ${symbol}, proceeding without PER/PBR/earnings data`, error);
    return { per: undefined, pbr: undefined, earningsAnnouncedToday: false };
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const session = parseSession(process.argv);
  const profile = parseProfile(process.argv);
  const isCheapProfile = profile === 'cheap';
  const isHighBudgetProfile = profile === 'highbudget';
  const config = await readJsonConfig<DaytradeConfig>('daytrade.json');
  // 候補銘柄・thresholds・1銘柄あたりの上限は常にdaytrade.json（既定プロ
  // ファイルと共有、二重管理を避ける）。cheapプロファイルは追加で
  // maxUnitCostYenを、highbudgetプロファイルは追加でvirtualCapitalYenの
  // 上書き値を、それぞれ別の小さなconfigから読む。
  const maxUnitCostYen = isCheapProfile ? (await readJsonConfig<CheapProfileConfig>('daytrade-cheap.json')).maxUnitCostYen : undefined;
  const virtualCapitalYen = isHighBudgetProfile ? (await readJsonConfig<HighBudgetProfileConfig>('daytrade-highbudget.json')).virtualCapitalYen : config.virtualCapitalYen;
  const dirSuffix = isCheapProfile ? '-cheap' : isHighBudgetProfile ? '-highbudget' : '';
  const STATE_FILE = `daytrade-sim${dirSuffix}-state.json`;
  // docs/daytrade-sim(-cheap|-highbudget)/ is outside DATA_DIR's data/
  // convention (it's served as a static site via Cloudflare Pages, not a
  // feature's own state file), so it gets its own path relative to this file
  // rather than reusing writeJsonData.
  const DASHBOARD_DATA_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', `daytrade-sim${dirSuffix}`, 'data.json');
  const now = new Date();
  const today = todayJstDateString(now);

  const currentHour = jstHour(now);
  if (isImplausibleRunTime(currentHour)) {
    const message = `${session}セッションの実行が${currentHour}時JSTに行われました（TSE取引時間外）。GitHub Actionsのcron遅延でJST日付が繰り上がった可能性が高いため、状態を汚さないよう処理をスキップします。`;
    logger.warn(`daytrade-sim: ${message}`);
    if (!dryRun) {
      const webhookUrl = process.env.DISCORD_WEBHOOK_DAYTRADE;
      if (webhookUrl) {
        await postDiscordAlert(webhookUrl, 'デイトレSimスキップ（実行時刻異常）', message, 0xfaa61a);
      }
    }
    return;
  }

  let state = await readJsonData<DaytradeState>(STATE_FILE, createInitialState(virtualCapitalYen));
  // data/daytrade-sim-state.json predates taxPaidTotal/equityHistory —
  // readJsonData doesn't backfill missing fields on an existing file, and
  // `undefined + tax` in applySell would silently poison the running total
  // into NaN (which then round-trips through JSON as null). Backfill once.
  state.taxPaidTotal ??= 0;
  state.equityHistory ??= [];
  state.commissionPaidTotal ??= 0;
  state.pendingOrders ??= {};
  state.lastMorningRunDate ??= null;
  state.lastAfternoonRunDate ??= null;

  // lastRunSession alone can't detect "this exact session already ran today" —
  // see the comment on lastMorningRunDate/lastAfternoonRunDate in types.ts for
  // the 2026-09-16 incident (a GitHub Actions native cron delayed ~5h replayed
  // the morning slot after the real afternoon run had already completed and
  // moved lastRunSession to 'afternoon', which let it slip past a
  // lastRunSession-only check and reprocess morning with stale-labeled data).
  const sessionAlreadyRanToday = session === 'morning' ? state.lastMorningRunDate === today : state.lastAfternoonRunDate === today;
  if (sessionAlreadyRanToday) {
    logger.info(`daytrade-sim: already processed ${today} (${session}), skipping (last${session === 'morning' ? 'Morning' : 'Afternoon'}RunDate match)`);
    return;
  }

  const nameFor = (symbol: string) => config.items.find((item) => item.symbol === symbol)?.name ?? symbol;

  const failures: string[] = [];
  const currentPrices: Record<string, number> = {};
  const logCountBeforeThisRun = state.log.length;
  const newlyQueued: { symbol: string; order: PendingOrder }[] = []; // signals decided this run, not yet filled — reported separately from sessionTrades (which is what actually settled)

  for (const candidate of config.items) {
    const { symbol } = candidate;
    let snapshot: IntradaySnapshot;
    let history: DailyHistory;
    try {
      [snapshot, history] = await Promise.all([fetchIntradaySnapshot(symbol), fetchDailyHistory(symbol)]);
    } catch (error) {
      logger.error(`daytrade-sim: market data fetch failed for ${symbol}`, error);
      failures.push(`${nameFor(symbol)} (${symbol})`);
      continue;
    }

    currentPrices[symbol] = snapshot.dayClose;

    // Fill any order this symbol's previous session queued, before evaluating
    // a new signal — at the first price actually tradeable since that signal
    // fired, not the close that triggered it (see PendingOrder in types.ts).
    // A morning run's market fill is today's dayOpen (09:00 JST, the first
    // trade since yesterday afternoon's signal); an afternoon run's is today's
    // afternoonOpen (12:30 JST, the first trade since this morning's signal).
    // A tranche1 limit order (limitPrice set) instead only fills if that same
    // session's low (morningLow/afternoonLow) actually reached the limit —
    // at the limit price, or the session open if that gapped down even
    // further (2026年9月1日追加、詳細はtypes.tsのPendingOrder参照).
    const pending = state.pendingOrders[symbol];
    let orderStillPending = false;
    if (pending) {
      const sessionOpen = session === 'morning' ? snapshot.dayOpen : snapshot.afternoonOpen;
      const sessionLow = session === 'morning' ? snapshot.morningLow : snapshot.afternoonLow;
      let filled = false;

      if (pending.action === 'sell') {
        state = applySell(state, symbol, sessionOpen, today, pending.reason);
        filled = true;
      } else if (pending.action === 'buy' && pending.trancheNumber !== undefined) {
        if (pending.limitPrice === undefined) {
          state = applyBuy(state, symbol, sessionOpen, pending.trancheNumber, config.maxPositionYen, config.marginMultiplier, today, pending.reason);
          filled = true;
        } else if (sessionLow <= pending.limitPrice) {
          const fillPrice = Math.min(pending.limitPrice, sessionOpen);
          state = applyBuy(state, symbol, fillPrice, pending.trancheNumber, config.maxPositionYen, config.marginMultiplier, today, pending.reason);
          filled = true;
        } else if (daysSince(pending.queuedDate, today) >= LIMIT_ORDER_EXPIRY_DAYS) {
          // 指値が長期間刺さらなかったため失効させる（現実の指値注文にも期限がある）。
          filled = true;
        } else {
          orderStillPending = true;
        }
      }

      if (filled) {
        const remainingPending = { ...state.pendingOrders };
        delete remainingPending[symbol];
        state = { ...state, pendingOrders: remainingPending };
      }
    }

    if (orderStillPending) {
      continue; // 発注済みの指値がまだ生きているため、新しい判断はしない
    }

    if (history.closes.length < TREND_SMA_PERIOD) {
      logger.warn(`daytrade-sim: not enough daily history for ${symbol} to compute the ${TREND_SMA_PERIOD}-day trend SMA (${history.closes.length} closes), skipping`);
      continue;
    }

    const position = state.positions[symbol];
    const hasPosition = Boolean(position);

    // cheapプロファイル: 1単元（100株）の取得コストが基準未満の銘柄だけを
    // 新規建て対象とする（ユーザー要望、2026年9月3日）。既に保有中の銘柄は
    // 値上がりでこの基準を超えても対象から外さない（そのまま保有管理・
    // 手仕舞い判断は続ける）——フィルタするのは「新規に買うかどうか」だけ。
    // ここでスキップすることで、対象外銘柄の決算情報スクレイピング
    // （fetchFundamentals、ネットワークI/O）自体も省略できる。
    if (isCheapProfile && !hasPosition && snapshot.dayClose * LOT_SIZE >= maxUnitCostYen!) {
      continue;
    }

    const { per, pbr, earningsAnnouncedToday } = await fetchFundamentals(symbol, today);

    const morningMovePct = ((snapshot.morningClose - snapshot.previousClose) / snapshot.previousClose) * 100;
    const afternoonMovePct = ((snapshot.dayClose - snapshot.afternoonOpen) / snapshot.afternoonOpen) * 100;
    const fullDayMovePct = ((snapshot.dayClose - snapshot.previousClose) / snapshot.previousClose) * 100;
    const rsi14 = calcRsi14(history.closes);
    const volumeRatio = calcVolumeRatio(history.volumes);
    const sma75 = calcSma(history.closes, TREND_SMA_PERIOD);

    const tranchesHeld = (position?.tranches.length ?? 0) as 0 | 1 | 2 | 3;

    const signal = decideTrade(
      {
        hasPosition,
        tranchesHeld,
        avgEntryPrice: position ? avgEntryPrice(position) : 0,
        lastTrancheEntryPrice: position ? lastTrancheEntryPrice(position) : 0,
        canPyramidToday: position ? lastTrancheEntryDate(position) !== today : false,
        morningMovePct,
        afternoonMovePct,
        fullDayMovePct,
        dayClose: snapshot.dayClose,
        sma75,
        rsi14,
        volumeRatio,
        per,
        pbr,
        earningsAnnouncedToday,
      },
      config.thresholds,
    );

    // Not applied immediately — queued for the next session's open (see the
    // pending-fill block above and PendingOrder in types.ts). At most one
    // pending order per symbol: the fill step above already drained any
    // previous one before this signal was evaluated, so this always
    // overwrites cleanly rather than stacking.
    // maxPositionYenは銘柄ごとの上限（tranche1+2+3合計）。値上がりした銘柄は
    // tranche1ですら100株でこの上限を超えることがあり、その場合は絶対に
    // 約定できない（applyBuyが常にno-opする）ため、キューに積んで「約定予定」
    // として表示すること自体が誤り。ここで事前に弾く（2026-09-10、ユーザー指摘）。
    if (signal.action === 'buy' && signal.trancheNumber !== undefined && exceedsMaxPosition(state, symbol, signal.limitPrice ?? snapshot.dayClose, signal.trancheNumber, config.maxPositionYen)) {
      logger.info(`daytrade-sim: ${symbol} buy signal (tranche${signal.trancheNumber}) exceeds maxPositionYen at current price, skipping instead of queuing an unfillable order`);
    } else if (signal.action === 'buy' && signal.trancheNumber !== undefined) {
      const order: PendingOrder = { action: 'buy', trancheNumber: signal.trancheNumber, limitPrice: signal.limitPrice, reason: signal.reason, queuedDate: today };
      state = { ...state, pendingOrders: { ...state.pendingOrders, [symbol]: order } };
      newlyQueued.push({ symbol, order });
    } else if (signal.action === 'sell') {
      const order: PendingOrder = { action: 'sell', reason: signal.reason, queuedDate: today };
      state = { ...state, pendingOrders: { ...state.pendingOrders, [symbol]: order } };
      newlyQueued.push({ symbol, order });
    }
  }

  // 立花証券e支店の定額手数料は1日の約定代金合計に対して1回だけ発生する（1取引ごとの
  // TAX_RATE_ON_GAINSとは異なる）。afternoon（その日最後のセッション）でのみ、今日分の
  // 全ログ（morning＋afternoon）から約定代金合計を出して1回だけ控除する。
  if (session === 'afternoon') {
    const todayContractValueYen = state.log.filter((entry) => entry.date === today).reduce((sum, entry) => sum + entry.price * entry.shares, 0);
    state = applyDailyCommission(state, calcDailyCommission(todayContractValueYen));
  }

  const sessionTrades = state.log.slice(logCountBeforeThisRun);
  state = { ...state, equityHistory: [...state.equityHistory, { date: today, session, totalEquity: calcTotalEquity(state, currentPrices) }] };
  const profileLabel = isCheapProfile
    ? `（1単元${maxUnitCostYen!.toLocaleString('ja-JP')}円未満）`
    : isHighBudgetProfile
      ? `（元本${virtualCapitalYen.toLocaleString('ja-JP')}円）`
      : undefined;
  const embed = await buildDaytradeSimEmbed({ date: today, session, state, sessionTrades, newlyQueued, currentPrices, nameFor, profileLabel });
  const pieEmbed = await buildAllocationPieEmbed(state, currentPrices, nameFor, profileLabel);
  const embeds = pieEmbed ? [embed, pieEmbed] : [embed];

  if (failures.length > 0) {
    embed.description = `${embed.description}\n\n取得できなかった銘柄: ${failures.join('・')}`;
  }

  if (dryRun) {
    logger.info('Dry run: daytrade-sim embed (not posted, state not saved)', { embeds, sessionTrades, newlyQueued, failures });
    return;
  }

  // 2026年9月16日変更: 前場（11:35 JST）の通知が「昼に来る」という不満を受け、
  // 状態更新・ダッシュボード公開は毎セッション続けつつ、Discordへの投稿だけを
  // 「このセッションで実際に約定があった（sessionTrades）」または「銘柄データの
  // 取得に失敗した（failuresは埋もれさせると気づけない）」ときに絞った。newlyQueued
  // （次セッション約定待ちのシグナル、まだ約定していない）だけでは投稿しない —
  // ユーザー要望は明確に「売買があったときだけ」だったため。
  const shouldNotify = sessionTrades.length > 0 || failures.length > 0;
  if (shouldNotify) {
    const webhookUrl = requireEnv('DISCORD_WEBHOOK_DAYTRADE');
    await postDiscordEmbeds(webhookUrl, embeds);
    logger.info(`daytrade-sim: posted ${session} report to Discord (${sessionTrades.length} trade(s) this session)`);
  } else {
    logger.info(`daytrade-sim: no trades in ${session} session, skipping Discord notification`);
  }

  state = pruneLog(
    {
      ...state,
      lastRunDate: today,
      lastRunSession: session,
      lastMorningRunDate: session === 'morning' ? today : state.lastMorningRunDate,
      lastAfternoonRunDate: session === 'afternoon' ? today : state.lastAfternoonRunDate,
    },
    today,
  );
  await writeJsonData(STATE_FILE, state);

  // Unlike the Discord embeds, this isn't length-capped — full equityHistory
  // and full trade log, since the dashboard (docs/daytrade-sim/, deployed via
  // Cloudflare Pages) has no Discord-style size limit to work around.
  const dashboardData = buildDashboardData(state, currentPrices, nameFor, virtualCapitalYen);
  await writeFile(DASHBOARD_DATA_PATH, `${JSON.stringify(dashboardData, null, 2)}\n`, 'utf-8');
}

main().catch(async (error) => {
  logger.error('daytrade-sim: fatal error', error);
  process.exitCode = 1;

  const webhookUrl = process.env.DISCORD_WEBHOOK_DAYTRADE;
  if (webhookUrl) {
    await postDiscordAlert(webhookUrl, 'デイトレSim失敗', String((error as Error)?.stack ?? error));
  }
});
