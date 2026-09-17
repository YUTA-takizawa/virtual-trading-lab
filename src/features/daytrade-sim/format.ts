import type { DiscordEmbed, DiscordEmbedField } from '../../shared/discordClient.ts';
import { joinWithinFieldLimit } from '../../shared/discordClient.ts';
import type { DaytradeLogEntry, DaytradeSession, DaytradeState, EquityPoint, PendingOrder } from './types.ts';
import { avgEntryPrice, calcTotalEquity, calcUnrealizedPnl, totalShares } from './portfolio.ts';
import { formatMoney, formatSignedMoney } from '../../shared/moneyFormat.ts';
import { createQuickChartUrl, distinctColors, type ChartSpec } from '../../shared/quickchart.ts';

const SESSION_LABEL: Record<DaytradeSession, string> = { morning: '午前', afternoon: '午後' };

const COLOR = 0x5865f2;

// rules.ts always ends a buy/sell `reason` with a trailing "（ルールN: ...）"-
// style tag (see src/features/daytrade-sim/rules.ts). Discord only needs to
// show that tag, not the full percentage/RSI/volume detail behind it — the
// full reason is still kept in data/daytrade-sim-state.json's log for
// debugging. Full rule descriptions live in README.md's daytrade-sim section.
function extractRuleTag(reason: string): string {
  const match = reason.match(/（([^（）]+)）$/);
  return match?.[1] ?? reason;
}

// 1:2:6ピラミッディングの段階名（tranche1〜3）。英語の"tranche"表記だと分かりにくいため、
// rules.tsのルール1（打診買い）の理由文言で既に使っている呼称に統一している。
const TRANCHE_LABEL: Record<number, string> = { 1: '打診買い', 2: '追撃買い', 3: '本買い' };

function formatTradeLine(entry: DaytradeLogEntry, nameFor: (symbol: string) => string): string {
  const label = entry.action === 'buy' ? (TRANCHE_LABEL[entry.trancheNumber ?? 0] ?? '買い') : '売り';
  // Net of the 20.315% withholding tax on gains (0 on a losing trade) — see
  // TAX_RATE_ON_GAINS in portfolio.ts. This is what actually lands in cash;
  // gross/tax breakdown for the day is in the summary description instead.
  const netPnl = entry.realizedPnl !== undefined ? entry.realizedPnl - (entry.tax ?? 0) : undefined;
  const pnlSuffix = entry.action === 'sell' && netPnl !== undefined ? `　実現損益 ${formatSignedMoney(netPnl)}（税引後）` : '';
  return `**${label}**　${nameFor(entry.symbol)} (${entry.symbol})　${entry.shares}株 @ ${formatMoney(entry.price)}${pnlSuffix}\n└ ${extractRuleTag(entry.reason)}`;
}

// A signal decided this session but queued for the next session's open
// (2026-08-31 rearchitecture — see PendingOrder in types.ts) has no price or
// share count yet, so this is deliberately a lighter-weight line than
// formatTradeLine's.
function formatQueuedLine(symbol: string, order: PendingOrder, nameFor: (symbol: string) => string): string {
  const label = order.action === 'buy' ? (TRANCHE_LABEL[order.trancheNumber ?? 0] ?? '買い') : '売り';
  const priceNote = order.limitPrice !== undefined ? `　指値 ${formatMoney(order.limitPrice)}` : '';
  return `**${label}予定**${priceNote}　${nameFor(symbol)} (${symbol})\n└ ${extractRuleTag(order.reason)}`;
}

// Capped to the most recent points so the chart itself stays readable;
// equityHistory is pruned separately (see pruneLog in index.ts) and can hold much more.
const CHART_MAX_POINTS = 30;

function buildEquityChartSpec(history: EquityPoint[]): ChartSpec | undefined {
  if (history.length < 2) {
    return undefined; // a one-point line chart isn't useful
  }
  const recent = history.slice(-CHART_MAX_POINTS);
  const labels = recent.map((point) => `${point.date.slice(5)}${SESSION_LABEL[point.session]}`); // "08-20午前"
  const values = recent.map((point) => Math.round(point.totalEquity));

  const chartConfig = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: '資産評価額',
          data: values,
          borderColor: '#5865f2',
          backgroundColor: 'rgba(88, 101, 242, 0.15)',
          fill: true,
          pointRadius: 2,
          tension: 0.1,
        },
      ],
    },
    options: {
      // QuickChart defaults to Chart.js v2 unless &v=4 is passed, and v2 reads
      // legend/title at the top of `options`, not nested under `plugins` —
      // the plugins-nested form is silently ignored, leaving the default
      // legend visible and no title (caught by rendering an actual preview).
      legend: { display: false },
      title: { display: true, text: '資産評価額の推移（現金＋保有ポジション時価）' },
      // Day-to-day moves are small relative to the ~1,000,000円 starting
      // capital, so a 0-based y-axis flattens them into an invisible line
      // (caught by rendering an actual preview) — auto-scale to the data's
      // own range instead, same convention as a stock price chart.
      scales: { yAxes: [{ ticks: { beginAtZero: false } }] },
    },
  };

  return { config: chartConfig, width: 700, height: 350 };
}

function buildAllocationPieChartSpec(state: DaytradeState, currentPrices: Record<string, number>, nameFor: (symbol: string) => string): ChartSpec | undefined {
  const entries = Object.entries(state.positions);
  if (entries.length === 0) {
    return undefined;
  }

  const slices = entries.map(([symbol, position]) => {
    const shares = totalShares(position);
    const price = currentPrices[symbol] ?? avgEntryPrice(position);
    return { label: `${nameFor(symbol)} (${symbol})`, value: Math.round(price * shares) };
  });

  const chartConfig = {
    type: 'pie',
    data: {
      labels: slices.map((s) => s.label),
      datasets: [{ data: slices.map((s) => s.value), backgroundColor: distinctColors(slices.length) }],
    },
    options: {
      legend: { display: true, position: 'right' },
      title: { display: true, text: '保有ポジションの内訳（時価ベース）' },
    },
  };

  return { config: chartConfig, width: 800, height: 600 };
}

/**
 * Pie chart of open positions by mark-to-market value (falls back to
 * avgEntryPrice per calcTotalEquity's convention when a current price is
 * missing). A separate embed from buildDaytradeSimEmbed's — Discord embeds
 * only carry one `image` each, and index.ts sends both in the same webhook
 * call as a 2-embed array. Returns undefined both when there are no open
 * positions and when the QuickChart short-URL request fails — either way,
 * there's nothing useful to show.
 */
export async function buildAllocationPieEmbed(
  state: DaytradeState,
  currentPrices: Record<string, number>,
  nameFor: (symbol: string) => string,
  profileLabel?: string,
): Promise<DiscordEmbed | undefined> {
  const spec = buildAllocationPieChartSpec(state, currentPrices, nameFor);
  if (!spec) {
    return undefined;
  }
  const chartUrl = await createQuickChartUrl(spec);
  if (!chartUrl) {
    return undefined;
  }
  return {
    title: `日本株デイトレシミュ 保有内訳${profileLabel ? ` ${profileLabel}` : ''}`,
    color: COLOR,
    image: { url: chartUrl },
  };
}

export interface DailySummaryInput {
  date: string; // YYYY-MM-DD, JST
  session: DaytradeSession; // which of today's two runs (morning ~11:35, afternoon ~15:35 JST) this is
  state: DaytradeState; // state *after* this session's fills have been applied
  sessionTrades: DaytradeLogEntry[]; // orders *filled* this run (queued by the previous session's signals), not decided this run
  newlyQueued: { symbol: string; order: PendingOrder }[]; // signals decided this run, not yet filled — settle next session
  currentPrices: Record<string, number>;
  nameFor: (symbol: string) => string;
  // ASCII suffix appended to the embed title to distinguish an alternate
  // profile (e.g. index.ts's --profile=cheap, the <¥100,000/unit variant,
  // 2026年9月3日追加) sharing the same DISCORD_WEBHOOK_DAYTRADE channel.
  // Unset for the default profile — title stays exactly as before.
  profileLabel?: string;
}

export async function buildDaytradeSimEmbed(input: DailySummaryInput): Promise<DiscordEmbed> {
  const { session, state, sessionTrades, newlyQueued, currentPrices, nameFor, profileLabel } = input;
  const sessionLabel = SESSION_LABEL[session];

  const unrealizedPnl = calcUnrealizedPnl(state, currentPrices);
  const totalEquity = calcTotalEquity(state, currentPrices);

  // Net of both the withholding tax (TAX_RATE_ON_GAINS) and 立花証券e支店's daily
  // flat commission (calcDailyCommission) — the actual bottom line after real costs.
  const netRealizedPnlTotal = state.realizedPnlTotal - state.taxPaidTotal - state.commissionPaidTotal;
  const summaryLines = [
    `現金 ${formatMoney(state.cash)} / 保有ポジション時価込み評価額 ${formatMoney(totalEquity)}`,
    `実現損益（累計・税引前） ${formatSignedMoney(state.realizedPnlTotal)} / 支払税額（累計） ${formatMoney(state.taxPaidTotal)}`,
    `支払手数料（累計） ${formatMoney(state.commissionPaidTotal)} / 実現損益（手数料・税引後） ${formatSignedMoney(netRealizedPnlTotal)}`,
    `含み損益 ${formatSignedMoney(unrealizedPnl)}`,
  ];

  const fields: DiscordEmbedField[] = [];

  fields.push({
    name: `本日${sessionLabel}に約定した売買`,
    value: sessionTrades.length > 0 ? joinWithinFieldLimit(sessionTrades.map((entry) => formatTradeLine(entry, nameFor))) : `本日${sessionLabel}に約定した売買はありませんでした`,
  });

  if (newlyQueued.length > 0) {
    // 引け後に判断しても、その引けの値段では買えない（すでに終わったセッションの
    // 値段には後から発注できない）ため、次のセッションの寄り付きで約定させる —
    // 2026-08-31、ユーザー指摘を受けた設計変更。詳細はREADME参照。
    fields.push({
      name: `本日${sessionLabel}に検知した新規シグナル（次回セッションの寄り付きで約定予定）`,
      value: joinWithinFieldLimit(newlyQueued.map(({ symbol, order }) => formatQueuedLine(symbol, order, nameFor))),
    });
  }

  const positionEntries = Object.entries(state.positions);
  if (positionEntries.length > 0) {
    const positionLines = positionEntries.map(([symbol, position]) => {
      const shares = totalShares(position);
      const avgPrice = avgEntryPrice(position);
      const currentPrice = currentPrices[symbol];
      const pnl = currentPrice === undefined ? undefined : (currentPrice - avgPrice) * shares;
      const pnlText = pnl === undefined ? '（現在値取得失敗）' : `含み損益 ${formatSignedMoney(pnl)}`;
      const firstEntryDate = position.tranches[0]?.entryDate ?? '?';
      return `${nameFor(symbol)} (${symbol}) 計${shares}株 @ 平均${formatMoney(avgPrice)}（${position.tranches.length}/3段階、${firstEntryDate}〜） ${pnlText}`;
    });
    fields.push({ name: '保有中のポジション', value: joinWithinFieldLimit(positionLines) });
  }

  const equityChartSpec = buildEquityChartSpec(state.equityHistory);
  const chartUrl = equityChartSpec ? await createQuickChartUrl(equityChartSpec) : undefined;

  return {
    // Discord's bold embed title font has no CJK glyphs on some clients (see
    // morning-digest/format.ts), so this stays ASCII (profileLabel included).
    title: `日本株デイトレシミュ ${session === 'morning' ? '前場' : '後場'}レポート${profileLabel ? ` ${profileLabel}` : ''}`,
    description: summaryLines.join('\n'),
    color: COLOR,
    fields,
    footer: { text: 'ルール一覧: README.md「daytrade-simの売買ルール一覧」参照' },
    image: chartUrl ? { url: chartUrl } : undefined,
    timestamp: new Date().toISOString(),
  };
}
