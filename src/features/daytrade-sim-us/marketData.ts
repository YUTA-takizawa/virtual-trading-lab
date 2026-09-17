// fetchDailyHistory is symbol-agnostic (just calls Yahoo's chart API with no
// JST/TSE-specific assumptions), so it's reused as-is from the JP module
// rather than duplicated — see src/features/daytrade-sim/marketData.ts.
export { fetchDailyHistory, type DailyHistory } from '../daytrade-sim/marketData.ts';

interface YahooChartResponse {
  chart: {
    result?: { indicators: { quote: { close: (number | null)[] }[] } }[];
    error?: { description: string } | null;
  };
}

/**
 * Current USD/JPY mid rate via Yahoo Finance's "JPY=X" FX ticker (same
 * unofficial chart API the rest of this project uses for equities — no
 * separate FX data source needed). Returns the latest available close.
 * The 15銭 Webull spread is applied on top of this by portfolio.ts, not here.
 */
export async function fetchUsdJpyRate(): Promise<number> {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/JPY=X?interval=1d&range=5d';
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) {
    throw new Error(`Yahoo Finance FX fetch failed (JPY=X): ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as YahooChartResponse;
  const result = data.chart.result?.[0];
  if (!result) {
    throw new Error(`Yahoo Finance returned no data for JPY=X: ${data.chart.error?.description ?? 'unknown error'}`);
  }
  const closes = result.indicators.quote[0]?.close ?? [];
  const lastClose = [...closes].reverse().find((c): c is number => c !== null && c !== undefined);
  if (lastClose === undefined) {
    throw new Error('Yahoo Finance FX response for JPY=X had no usable close price');
  }
  return lastClose;
}
