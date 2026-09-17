import type { DiscordEmbed, DiscordEmbedField } from '../../shared/discordClient.ts';
import { joinWithinFieldLimit } from '../../shared/discordClient.ts';
import { formatMoney, formatSignedMoney } from '../../shared/moneyFormat.ts';
import { createQuickChartUrl, distinctColors, type ChartSpec } from '../../shared/quickchart.ts';
import type { DaytradeUsLogEntry, DaytradeUsState, EquityPointUs, PendingOrderUs } from './types.ts';
import { avgEntryPriceUsd, calcTotalEquityJpy, calcUnrealizedPnlJpy, totalShares } from './portfolio.ts';

const COLOR = 0x2ca5e0; // distinct from the JP report's 0x5865f2, so the two are visually distinguishable at a glance in the same Discord channel

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

// Shares can be fractional (Webull's dollar-denominated orders, down to
// 0.00001 shares — see SHARE_PRECISION in portfolio.ts). Show up to 5
// decimal places but drop trailing zeros so a whole-share fill still reads as "66株".
function formatShares(value: number): string {
  return value.toFixed(5).replace(/\.?0+$/, '');
}

// Same convention as the JP version's format.ts: rules.ts always ends a
// buy/sell `reason` with a trailing "（ルールN: ...）" tag.
function extractRuleTag(reason: string): string {
  const match = reason.match(/（([^（）]+)）$/);
  return match?.[1] ?? reason;
}

// JP版format.tsと同じ呼称（rules.tsのルール1の文言に合わせている）。
const TRANCHE_LABEL: Record<number, string> = { 1: '打診買い', 2: '追撃買い', 3: '本買い' };

function formatTradeLine(entry: DaytradeUsLogEntry, nameFor: (symbol: string) => string): string {
  const label = entry.action === 'buy' ? (TRANCHE_LABEL[entry.trancheNumber ?? 0] ?? '買い') : '売り';
  const netJpy = entry.realizedPnlJpy !== undefined ? entry.realizedPnlJpy - (entry.tax ?? 0) : undefined;
  const pnlSuffix = entry.action === 'sell' && netJpy !== undefined ? `　実現損益 ${formatSignedMoney(netJpy)}（手数料・税引後）` : '';
  return `**${label}**　${nameFor(entry.symbol)} (${entry.symbol})　${formatShares(entry.shares)}株 @ ${formatUsd(entry.priceUsd)}（@${entry.fxRate.toFixed(2)}円）${pnlSuffix}\n└ ${extractRuleTag(entry.reason)}`;
}

// A signal decided this run but queued for tomorrow's open (2026-08-31
// rearchitecture — see PendingOrderUs in types.ts) has no price/shares yet.
function formatQueuedLine(symbol: string, order: PendingOrderUs, nameFor: (symbol: string) => string): string {
  const label = order.action === 'buy' ? (TRANCHE_LABEL[order.trancheNumber ?? 0] ?? '買い') : '売り';
  return `**${label}予定**　${nameFor(symbol)} (${symbol})\n└ ${extractRuleTag(order.reason)}`;
}

const CHART_MAX_POINTS = 30;

function buildEquityChartSpec(history: EquityPointUs[]): ChartSpec | undefined {
  if (history.length < 2) {
    return undefined;
  }
  const recent = history.slice(-CHART_MAX_POINTS);
  const labels = recent.map((point) => point.date.slice(5));
  const values = recent.map((point) => Math.round(point.totalEquityJpy));

  const chartConfig = {
    type: 'line',
    data: {
      labels,
      datasets: [{ label: '資産評価額（円）', data: values, borderColor: '#2ca5e0', backgroundColor: 'rgba(44, 165, 224, 0.15)', fill: true, pointRadius: 2, tension: 0.1 }],
    },
    options: {
      legend: { display: false },
      title: { display: true, text: '資産評価額の推移（円、現金＋保有ポジション時価）' },
      scales: { yAxes: [{ ticks: { beginAtZero: false } }] },
    },
  };
  return { config: chartConfig, width: 700, height: 350 };
}

function buildAllocationPieChartSpec(state: DaytradeUsState, currentPricesUsd: Record<string, number>, currentFxRate: number, nameFor: (symbol: string) => string): ChartSpec | undefined {
  const entries = Object.entries(state.positions);
  if (entries.length === 0) {
    return undefined;
  }
  const slices = entries.map(([symbol, position]) => {
    const shares = totalShares(position);
    const priceUsd = currentPricesUsd[symbol] ?? avgEntryPriceUsd(position);
    return { label: `${nameFor(symbol)} (${symbol})`, value: Math.round(priceUsd * shares * currentFxRate) };
  });
  const chartConfig = {
    type: 'pie',
    data: {
      labels: slices.map((s) => s.label),
      datasets: [{ data: slices.map((s) => s.value), backgroundColor: distinctColors(slices.length) }],
    },
    options: {
      legend: { display: true, position: 'right' },
      title: { display: true, text: '保有ポジションの内訳（円換算・時価ベース）' },
    },
  };
  return { config: chartConfig, width: 800, height: 600 };
}

export async function buildAllocationPieEmbedUs(
  state: DaytradeUsState,
  currentPricesUsd: Record<string, number>,
  currentFxRate: number,
  nameFor: (symbol: string) => string,
  profileLabel?: string,
): Promise<DiscordEmbed | undefined> {
  const spec = buildAllocationPieChartSpec(state, currentPricesUsd, currentFxRate, nameFor);
  if (!spec) return undefined;
  const chartUrl = await createQuickChartUrl(spec);
  if (!chartUrl) return undefined;
  return { title: `米国株デイトレシミュ 保有内訳${profileLabel ? ` ${profileLabel}` : ''}`, color: COLOR, image: { url: chartUrl } };
}

export interface DailySummaryInputUs {
  date: string; // YYYY-MM-DD, JST
  state: DaytradeUsState; // state *after* today's fills have been applied
  todaysTrades: DaytradeUsLogEntry[]; // orders *filled* today (queued by yesterday's signals), not decided today
  newlyQueued: { symbol: string; order: PendingOrderUs }[]; // signals decided today, not yet filled — settle tomorrow
  currentPricesUsd: Record<string, number>;
  currentFxRate: number;
  nameFor: (symbol: string) => string;
  // ASCII suffix appended to the embed title to distinguish an alternate
  // profile (e.g. index.ts's --profile=highbudget, 2026年9月4日追加) sharing
  // the same DISCORD_WEBHOOK_DAYTRADE channel. Unset for the default profile.
  profileLabel?: string;
}

export async function buildDaytradeSimUsEmbed(input: DailySummaryInputUs): Promise<DiscordEmbed> {
  const { state, todaysTrades, newlyQueued, currentPricesUsd, currentFxRate, nameFor, profileLabel } = input;

  const unrealizedPnlJpy = calcUnrealizedPnlJpy(state, currentPricesUsd, currentFxRate);
  const totalEquityJpy = calcTotalEquityJpy(state, currentPricesUsd, currentFxRate);
  // realizedPnlTotalJpy already nets out SEC/FINRA fees (subtracted from USD
  // proceeds before JPY conversion in applySell) — only tax is separate here.
  const netRealizedPnlJpy = state.realizedPnlTotalJpy - state.taxPaidTotalJpy;

  const summaryLines = [
    `現金 ${formatMoney(state.cashJpy)} / 保有ポジション時価込み評価額 ${formatMoney(totalEquityJpy)}（現在レート ${currentFxRate.toFixed(2)}円/ドル）`,
    `実現損益（手数料込み・税引前） ${formatSignedMoney(state.realizedPnlTotalJpy)} / 支払税額（累計） ${formatMoney(state.taxPaidTotalJpy)}`,
    `実現損益（手数料・税引後） ${formatSignedMoney(netRealizedPnlJpy)} / SEC・FINRA手数料累計 ${formatUsd(state.secFeeTotalUsd + state.finraFeeTotalUsd)}`,
    `含み損益 ${formatSignedMoney(unrealizedPnlJpy)}`,
  ];

  const fields: DiscordEmbedField[] = [];

  fields.push({
    name: '本日約定した売買',
    value: todaysTrades.length > 0 ? joinWithinFieldLimit(todaysTrades.map((e) => formatTradeLine(e, nameFor))) : '本日約定した売買はありませんでした',
  });

  if (newlyQueued.length > 0) {
    // 引け後に判断しても、その引けの値段では買えないため、翌営業日の寄り付きで
    // 約定させる — 2026-08-31、ユーザー指摘を受けた設計変更。README参照。
    fields.push({
      name: '本日検知した新規シグナル（翌営業日の寄り付きで約定予定）',
      value: joinWithinFieldLimit(newlyQueued.map(({ symbol, order }) => formatQueuedLine(symbol, order, nameFor))),
    });
  }

  const positionEntries = Object.entries(state.positions);
  if (positionEntries.length > 0) {
    const positionLines = positionEntries.map(([symbol, position]) => {
      const shares = totalShares(position);
      const avgPriceUsd = avgEntryPriceUsd(position);
      const currentPriceUsd = currentPricesUsd[symbol];
      const pnlJpy = currentPriceUsd === undefined ? undefined : (currentPriceUsd - avgPriceUsd) * shares * currentFxRate;
      const pnlText = pnlJpy === undefined ? '（現在値取得失敗）' : `含み損益 ${formatSignedMoney(pnlJpy)}`;
      const firstEntryDate = position.tranches[0]?.entryDate ?? '?';
      return `${nameFor(symbol)} (${symbol}) 計${formatShares(shares)}株 @ 平均${formatUsd(avgPriceUsd)}（${position.tranches.length}/3段階、${firstEntryDate}〜） ${pnlText}`;
    });
    fields.push({ name: '保有中のポジション', value: joinWithinFieldLimit(positionLines) });
  }

  const equityChartSpec = buildEquityChartSpec(state.equityHistory);
  const chartUrl = equityChartSpec ? await createQuickChartUrl(equityChartSpec) : undefined;

  return {
    title: `米国株デイトレシミュ 日次レポート${profileLabel ? ` ${profileLabel}` : ''}`,
    description: summaryLines.join('\n'),
    color: COLOR,
    fields,
    footer: { text: 'NYダウ30・NASDAQ100対象、ウィブル証券API接続前提のシミュレーション。ルールはdaytrade-sim（日本株版）準拠、PER/PBRフィルタ・場中決算プレイは対象外' },
    image: chartUrl ? { url: chartUrl } : undefined,
    timestamp: new Date().toISOString(),
  };
}
