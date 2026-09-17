const MORNING_CLOSE_MINUTES = 11 * 60 + 30; // 11:30 JST — 前場引け
const AFTERNOON_OPEN_MINUTES = 12 * 60 + 30; // 12:30 JST — 後場寄り

interface YahooChartMeta {
  gmtoffset: number;
  previousClose?: number;
  chartPreviousClose?: number;
}

interface YahooChartResult {
  meta: YahooChartMeta;
  timestamp?: number[];
  indicators: { quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }[] };
}

interface YahooChartResponse {
  chart: {
    result?: YahooChartResult[];
    error?: { description: string } | null;
  };
}

async function fetchChart(symbol: string, interval: string, range: string): Promise<YahooChartResult> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) {
    throw new Error(`Yahoo Finance fetch failed for ${symbol} (${interval}/${range}): ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as YahooChartResponse;
  const result = data.chart.result?.[0];
  if (!result) {
    throw new Error(`Yahoo Finance returned no data for ${symbol} (${interval}/${range}): ${data.chart.error?.description ?? 'unknown error'}`);
  }
  return result;
}

export interface IntradaySnapshot {
  symbol: string;
  previousClose: number;
  dayOpen: number; // price at/just after 9:00 JST (寄り付き近辺) — the first tradeable price of the day, used to fill orders queued by a signal from the previous afternoon session
  morningClose: number; // price at/just before 11:30 JST (前場引け近辺)
  morningLow: number; // 前場（9:00〜11:30）の安値。前日後場に発注された指値注文が、今日の前場で約定するかどうかの判定に使う（2026年9月1日追加）
  afternoonOpen: number; // price at/just after 12:30 JST (後場寄り近辺) — also used to fill orders queued by a signal from this same morning's session
  afternoonLow: number; // 後場（12:30〜大引け）の安値。今日の前場に発注された指値注文が、今日の後場で約定するかどうかの判定に使う（2026年9月1日追加）
  dayClose: number; // last traded price of the day (大引け、取引時間が変わっても追随する)
}

/**
 * Fetches today's 5-minute intraday bars and reduces them to the handful of
 * price points the rule engine (and, for dayOpen/afternoonOpen/morningLow/
 * afternoonLow, the deferred order-fill logic in index.ts) needs: previous
 * close, 寄り付き, 前場引け, 前場安値, 後場寄り, 後場安値, 大引け. Bars during
 * the 11:30-12:30 lunch break come back as null and are skipped. Uses "last
 * non-null bar of the day" for dayClose rather than a hardcoded closing time,
 * since TSE's afternoon session close moved from 15:00 to 15:30 in Nov 2024
 * and could change again.
 */
export async function fetchIntradaySnapshot(symbol: string): Promise<IntradaySnapshot> {
  const result = await fetchChart(symbol, '5m', '1d');
  const timestamps = result.timestamp ?? [];
  const quote = result.indicators.quote[0];
  const closes = quote?.close ?? [];
  const lows = quote?.low ?? [];
  const previousClose = result.meta.previousClose ?? result.meta.chartPreviousClose;
  if (previousClose === undefined) {
    throw new Error(`Yahoo Finance intraday response for ${symbol} had no previousClose`);
  }

  const bars = timestamps
    .map((ts, i) => ({ jstMinutes: minutesSinceMidnightJst(ts, result.meta.gmtoffset), close: closes[i], low: lows[i] }))
    .filter((bar): bar is { jstMinutes: number; close: number; low: number } => bar.close !== null && bar.close !== undefined && bar.low !== null && bar.low !== undefined);

  if (bars.length === 0) {
    throw new Error(`Yahoo Finance intraday response for ${symbol} had no trading bars (market likely closed today)`);
  }

  const morningBars = bars.filter((bar) => bar.jstMinutes <= MORNING_CLOSE_MINUTES);
  const afternoonBars = bars.filter((bar) => bar.jstMinutes >= AFTERNOON_OPEN_MINUTES);

  return {
    symbol,
    previousClose,
    dayOpen: bars[0]!.close,
    morningClose: (morningBars.at(-1) ?? bars[0]!).close,
    morningLow: Math.min(...(morningBars.length > 0 ? morningBars : [bars[0]!]).map((bar) => bar.low)),
    afternoonOpen: (afternoonBars[0] ?? bars.at(-1)!).close,
    afternoonLow: Math.min(...(afternoonBars.length > 0 ? afternoonBars : [bars.at(-1)!]).map((bar) => bar.low)),
    dayClose: bars.at(-1)!.close,
  };
}

function minutesSinceMidnightJst(unixSeconds: number, gmtoffsetSeconds: number): number {
  const jstDate = new Date((unixSeconds + gmtoffsetSeconds) * 1000);
  return jstDate.getUTCHours() * 60 + jstDate.getUTCMinutes();
}

export interface DailyHistory {
  opens: number[]; // added 2026-08-31 for the US module's deferred-fill logic (index.ts) — "today's open" is opens.at(-1)
  highs: number[]; // added 2026-08-31 for crypto-strategy-lab (breakout/Bollinger strategies)
  lows: number[];
  closes: number[];
  volumes: number[];
}

/**
 * Fetches ~1 year of daily bars. Originally 6 months (enough for RSI(14),
 * volume-trend, and the 75-day SMA trend filter), extended 2026-09-01 for
 * src/features/us-strategy-lab/'s 200-day SMA and 200-day-high strategies,
 * which need ~201 trading days of history. All arrays are chronologically
 * ordered oldest-to-newest, index-aligned, and exclude any bar missing open,
 * high, low, close, or volume (non-trading days occasionally show up as gaps
 * in this feed). Existing callers (JP/US/crypto single-strategy modules,
 * crypto-strategy-lab) only ever slice a trailing window off the end, so the
 * extra leading history is harmless to them.
 */
export async function fetchDailyHistory(symbol: string): Promise<DailyHistory> {
  const result = await fetchChart(symbol, '1d', '1y');
  const quote = result.indicators.quote[0];
  const opens: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const closes: number[] = [];
  const volumes: number[] = [];
  for (let i = 0; i < (result.timestamp ?? []).length; i++) {
    const open = quote?.open[i];
    const high = quote?.high[i];
    const low = quote?.low[i];
    const close = quote?.close[i];
    const volume = quote?.volume[i];
    if (
      open !== null && open !== undefined &&
      high !== null && high !== undefined &&
      low !== null && low !== undefined &&
      close !== null && close !== undefined &&
      volume !== null && volume !== undefined
    ) {
      opens.push(open);
      highs.push(high);
      lows.push(low);
      closes.push(close);
      volumes.push(volume);
    }
  }
  return { opens, highs, lows, closes, volumes };
}
