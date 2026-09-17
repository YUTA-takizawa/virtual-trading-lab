import type { DiscordEmbed, DiscordEmbedField } from '../../shared/discordClient.ts';
import { joinWithinFieldLimit } from '../../shared/discordClient.ts';
import { formatMoney, formatSignedMoney } from '../../shared/moneyFormat.ts';
import { createQuickChartUrl, distinctColors, type ChartSpec } from '../../shared/quickchart.ts';
import type { DaytradeCryptoLogEntry, DaytradeCryptoSession, DaytradeCryptoState, EquityPointCrypto } from './types.ts';
import { avgEntryPriceJpy, calcTotalEquityJpy, calcUnrealizedPnlJpy, totalQuantity } from './portfolio.ts';

const COLOR = 0xf7931a; // bitcoin-orange — distinct from JP (0x5865f2) and US (0x2ca5e0) reports in the same Discord channel

const SESSION_LABEL: Record<DaytradeCryptoSession, string> = { morning: '早朝', night: '夜' };

// Crypto quantities range from thousands (DOGE) to fractions of a millionth
// (BTC) — show up to 8 decimals (satoshi-level, matches QUANTITY_PRECISION
// in portfolio.ts) but trim trailing zeros so a round DOGE buy doesn't show ".00000000".
function formatQuantity(value: number): string {
  return value.toFixed(8).replace(/\.?0+$/, '');
}

// Same convention as the JP/US versions' format.ts: rules.ts always ends a
// buy/sell `reason` with a trailing "（ルールN: ...）" tag.
function extractRuleTag(reason: string): string {
  const match = reason.match(/（([^（）]+)）$/);
  return match?.[1] ?? reason;
}

// Same labels as the JP/US format.ts (matches rules.ts's rule-1 wording).
const TRANCHE_LABEL: Record<number, string> = { 1: '打診買い', 2: '追撃買い', 3: '本買い' };

function formatTradeLine(entry: DaytradeCryptoLogEntry, nameFor: (symbol: string) => string): string {
  const label = entry.action === 'buy' ? (TRANCHE_LABEL[entry.trancheNumber ?? 0] ?? '買い') : '売り';
  const pnlSuffix = entry.action === 'sell' && entry.realizedPnlJpy !== undefined ? `　実現損益 ${formatSignedMoney(entry.realizedPnlJpy)}（税引き前・スプレッド込み）` : '';
  return `**${label}**　${nameFor(entry.symbol)} (${entry.symbol})　${formatQuantity(entry.quantity)} @ ${formatMoney(entry.priceJpy)}${pnlSuffix}\n└ ${extractRuleTag(entry.reason)}`;
}

const CHART_MAX_POINTS = 30;

function buildEquityChartSpec(history: EquityPointCrypto[]): ChartSpec | undefined {
  if (history.length < 2) {
    return undefined;
  }
  const recent = history.slice(-CHART_MAX_POINTS);
  const labels = recent.map((point) => `${point.date.slice(5)}${SESSION_LABEL[point.session]}`);
  const values = recent.map((point) => Math.round(point.totalEquityJpy));

  const chartConfig = {
    type: 'line',
    data: {
      labels,
      datasets: [{ label: '資産評価額（円）', data: values, borderColor: '#f7931a', backgroundColor: 'rgba(247, 147, 26, 0.15)', fill: true, pointRadius: 2, tension: 0.1 }],
    },
    options: {
      legend: { display: false },
      title: { display: true, text: '資産評価額の推移（円、現金＋保有ポジション時価）' },
      scales: { yAxes: [{ ticks: { beginAtZero: false } }] },
    },
  };
  return { config: chartConfig, width: 700, height: 350 };
}

function buildAllocationPieChartSpec(state: DaytradeCryptoState, currentPricesJpy: Record<string, number>, nameFor: (symbol: string) => string): ChartSpec | undefined {
  const entries = Object.entries(state.positions);
  if (entries.length === 0) {
    return undefined;
  }
  const slices = entries.map(([symbol, position]) => {
    const quantity = totalQuantity(position);
    const priceJpy = currentPricesJpy[symbol] ?? avgEntryPriceJpy(position);
    return { label: `${nameFor(symbol)} (${symbol})`, value: Math.round(priceJpy * quantity) };
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

export async function buildAllocationPieEmbedCrypto(
  state: DaytradeCryptoState,
  currentPricesJpy: Record<string, number>,
  nameFor: (symbol: string) => string,
  profileLabel?: string,
): Promise<DiscordEmbed | undefined> {
  const spec = buildAllocationPieChartSpec(state, currentPricesJpy, nameFor);
  if (!spec) return undefined;
  const chartUrl = await createQuickChartUrl(spec);
  if (!chartUrl) return undefined;
  return { title: `暗号資産デイトレシミュ 保有内訳${profileLabel ? ` ${profileLabel}` : ''}`, color: COLOR, image: { url: chartUrl } };
}

export interface DailySummaryInputCrypto {
  date: string; // YYYY-MM-DD, JST
  session: DaytradeCryptoSession; // cosmetic label only (JST hour at notify time) — checks run every 15 min regardless, see index.ts
  state: DaytradeCryptoState; // state *after* this notification's trades have been applied
  newTrades: DaytradeCryptoLogEntry[]; // every buy/sell since the *previous* notification, not just the latest 15-min check
  currentPricesJpy: Record<string, number>;
  nameFor: (symbol: string) => string;
  // ASCII suffix appended to the embed title to distinguish an alternate
  // profile (e.g. index.ts's --profile=highbudget, 2026年9月4日追加) sharing
  // the same DISCORD_WEBHOOK_DAYTRADE channel. Unset for the default profile.
  profileLabel?: string;
}

export async function buildDaytradeSimCryptoEmbed(input: DailySummaryInputCrypto): Promise<DiscordEmbed> {
  const { session, state, newTrades, currentPricesJpy, nameFor, profileLabel } = input;
  const sessionLabel = SESSION_LABEL[session];

  const unrealizedPnlJpy = calcUnrealizedPnlJpy(state, currentPricesJpy);
  const totalEquityJpy = calcTotalEquityJpy(state, currentPricesJpy);

  const summaryLines = [
    `現金 ${formatMoney(state.cashJpy)} / 保有ポジション時価込み評価額 ${formatMoney(totalEquityJpy)}`,
    `実現損益（累計・税引き前・スプレッド込み） ${formatSignedMoney(state.realizedPnlTotalJpy)}`,
    `スプレッドコスト（累計・参考値） ${formatMoney(state.spreadCostTotalJpy)}`,
    `含み損益 ${formatSignedMoney(unrealizedPnlJpy)}`,
  ];

  const fields: DiscordEmbedField[] = [];

  fields.push({
    name: `前回通知（${sessionLabel}）以降の売買`,
    value: newTrades.length > 0 ? joinWithinFieldLimit(newTrades.map((entry) => formatTradeLine(entry, nameFor))) : '前回通知以降の売買はありませんでした',
  });

  const positionEntries = Object.entries(state.positions);
  if (positionEntries.length > 0) {
    const positionLines = positionEntries.map(([symbol, position]) => {
      const quantity = totalQuantity(position);
      const avgPriceJpy = avgEntryPriceJpy(position);
      const currentPriceJpy = currentPricesJpy[symbol];
      const pnlJpy = currentPriceJpy === undefined ? undefined : (currentPriceJpy - avgPriceJpy) * quantity;
      const pnlText = pnlJpy === undefined ? '（現在値取得失敗）' : `含み損益 ${formatSignedMoney(pnlJpy)}`;
      const firstEntryDate = position.tranches[0]?.entryDate ?? '?';
      return `${nameFor(symbol)} (${symbol}) 計${formatQuantity(quantity)} @ 平均${formatMoney(avgPriceJpy)}（${position.tranches.length}/3段階、${firstEntryDate}〜） ${pnlText}`;
    });
    fields.push({ name: '保有中のポジション', value: joinWithinFieldLimit(positionLines) });
  }

  const equityChartSpec = buildEquityChartSpec(state.equityHistory);
  const chartUrl = equityChartSpec ? await createQuickChartUrl(equityChartSpec) : undefined;

  return {
    title: `暗号資産デイトレシミュ ${session === 'morning' ? '朝' : '夜'}レポート${profileLabel ? ` ${profileLabel}` : ''}`,
    description: summaryLines.join('\n'),
    color: COLOR,
    fields,
    footer: { text: '暗号資産（GMOコイン現物取引想定）、土日含め15分おきに売買判定・通知は前回から8時間以上経過時のみ（1日3回程度）。税金は雑所得のため計算せず税引き前で表示。ルールは米国株版（daytrade-sim-us）準拠、PER/PBRフィルタ・場中決算プレイは対象外' },
    image: chartUrl ? { url: chartUrl } : undefined,
    timestamp: new Date().toISOString(),
  };
}
