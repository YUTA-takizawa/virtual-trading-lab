// fetchDailyHistory is symbol-agnostic (confirmed working for JP tickers,
// US tickers, and now crypto "-JPY" tickers like BTC-JPY against the same
// Yahoo Finance chart API) — reused as-is, no FX fetch needed since crypto
// tickers here are already JPY-denominated.
export { fetchDailyHistory, type DailyHistory } from '../daytrade-sim/marketData.ts';
