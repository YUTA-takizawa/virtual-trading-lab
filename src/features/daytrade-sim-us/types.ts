// 米国株版（NYダウ30・NASDAQ100、ウィブル証券API接続前提）。日本株版
// （src/features/daytrade-sim/）との主な違い:
// - 米国市場は前場/後場の区切りがない連続取引なので、1日1回・前日終値と
//   当日終値の比較だけで急落/急騰を判定する（セッション分割なし）
// - 1:2:6は円の配分比率のまま（100株単位化はしない — ユーザー指示により
//   日本株版の単元株修正"前"の条件に戻す。ウィブル証券は端株取引に対応して
//   おり、金額指定なら$1単位・株数指定なら0.00001株単位で発注可能なため）
// - PER/PBRフィルタ・場中決算プレイは対象外（データソース未整備、意図的に省略）
// - 為替（USD/JPY）が絡むため、cashは常に円建て、ポジションは各tranche個別に
//   建値の為替レートを保持し、決済時に個別のレートで円換算する
// - 2026-08-31: 引け後の値段を見てから即座にその値段で約定させていたのは非現実的
//   （引け後に注文を出しても、もう終わったセッションの値段では買えない）と
//   ユーザーから指摘を受け、シグナルは即約定させず翌営業日の始値まで
//   PendingOrderとして持ち越す方式に変更（日本株版と同じ設計、詳細は
//   src/features/daytrade-sim/types.tsのPendingOrderコメント参照）

export interface DaytradeUsThresholds {
  crashPct: number; // 前日終値比でこの%以上下落したら「急落」（新規買いのトリガー）
  surgePct: number; // 保有中に前日終値比でこの%以上上昇したら「急騰」（利確のトリガー）
  flatDayPct: number; // この%未満の値動きは「方向感のない日」として新規買いを見送る
  rsiBuyConfirmMax: number;
  rsiSellConfirmMin: number;
  volumeRatioMin: number;
  stopLossPct: number; // 0または未設定なら無効
  tranche2ConfirmPct: number;
}

export interface DaytradeUsCandidate {
  symbol: string;
  name: string;
}

export interface DaytradeUsConfig {
  note?: string;
  virtualCapitalYen: number;
  maxPositionYen: number; // 1銘柄あたりの取得コスト上限（円換算）
  marginMultiplier: number;
  thresholds: DaytradeUsThresholds;
  items: DaytradeUsCandidate[];
}

export interface PositionTrancheUs {
  trancheNumber: 1 | 2 | 3;
  shares: number;
  entryPriceUsd: number;
  entryFxRate: number; // このtrancheを買った時に実際に使った円→ドルの実効レート（fxRate + スプレッド）
  entryDate: string; // YYYY-MM-DD, JST
}

export interface DaytradeUsPosition {
  tranches: PositionTrancheUs[];
}

export type TradeAction = 'buy' | 'sell';
export type DecisionAction = TradeAction | 'hold' | 'skip';

export interface RuleInputsUs {
  hasPosition: boolean;
  tranchesHeld: 0 | 1 | 2 | 3;
  avgEntryPriceUsd: number; // 0 when hasPosition is false
  lastTrancheEntryPriceUsd: number; // 0 when hasPosition is false
  canPyramidToday: boolean;
  dailyMovePct: number; // 前日終値 -> 当日終値（このシミュレーターの唯一の値動き指標）
  dayClose: number; // 当日終値（USD）
  sma75: number; // 75日移動平均（USD）
  rsi14: number;
  volumeRatio: number;
}

export interface RuleSignalUs {
  action: DecisionAction;
  reason: string;
  trancheNumber?: 1 | 2 | 3;
}

// A buy/sell decided this run but not yet filled — see the same-named type
// in src/features/daytrade-sim/types.ts for why. Filled on the *next* run
// using that run's opening price (history.opens.at(-1) in marketData.ts)
// and that run's freshly-fetched FX rate, not the rate from when it queued.
export interface PendingOrderUs {
  action: TradeAction;
  trancheNumber?: 1 | 2 | 3; // only for 'buy'
  reason: string;
  queuedDate: string;
}

export interface DaytradeUsLogEntry {
  date: string;
  symbol: string;
  action: TradeAction;
  priceUsd: number;
  fxRate: number; // 実効レート（買い: +スプレッド、売り: -スプレッド）
  shares: number;
  reason: string;
  trancheNumber?: 1 | 2 | 3;
  realizedPnlJpy?: number; // 売りのみ。円建て・税引前（為替差損益込み）
  tax?: number;
  secFeeUsd?: number; // 売りのみ
  finraFeeUsd?: number; // 売りのみ
}

export interface EquityPointUs {
  date: string;
  totalEquityJpy: number; // 現金（円）＋保有ポジション時価（当日のFXレートで円換算）
}

export interface DaytradeUsState {
  cashJpy: number;
  realizedPnlTotalJpy: number; // 累計・税引前（為替差損益込み）
  taxPaidTotalJpy: number;
  secFeeTotalUsd: number; // 累計（ドル建てのまま。円換算は都度のレートで変わるため生の合計を保持）
  finraFeeTotalUsd: number;
  positions: Record<string, DaytradeUsPosition>;
  pendingOrders: Record<string, PendingOrderUs>; // symbol -> order queued last run, filled at the start of this run before new signals are evaluated
  lastRunDate: string | null; // 1日1回しか実行しないため、セッション区別は不要
  log: DaytradeUsLogEntry[];
  equityHistory: EquityPointUs[];
}

export function createInitialUsState(virtualCapitalYen: number): DaytradeUsState {
  return {
    cashJpy: virtualCapitalYen,
    realizedPnlTotalJpy: 0,
    taxPaidTotalJpy: 0,
    secFeeTotalUsd: 0,
    finraFeeTotalUsd: 0,
    positions: {},
    pendingOrders: {},
    lastRunDate: null,
    log: [],
    equityHistory: [],
  };
}
