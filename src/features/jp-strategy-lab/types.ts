// 日本株版の戦略比較ラボ（2026年9月4日、ユーザー要望「もっとわがまま言います」
// で追加）。src/features/crypto-strategy-lab/・us-strategy-lab/と同じ設計
// 思想（銘柄横断で同一の指標セットを1回だけ計算し、複数の独立した"手法
// そのもの"を同一条件・別会計で並行シミュレーションしてダッシュボードで
// 比較する）を踏襲する。既存の22戦略・30戦略ラボと違い、現時点では戦略が
// 1本（スイングブラケット戦略）しかないが、「新しいダッシュボードを増やす
// たびにナビゲーションが煩雑になる」という同日のユーザー指摘を受け、今後
// 戦略が増えてもページを増やさずこのラボ内に追加できるよう、最初から
// マルチ戦略ダッシュボードの形で作っている。

export interface Lot {
  quantity: number;
  entryPriceJpy: number;
  entryDate: string; // YYYY-MM-DD, JST
}

export interface StrategyPosition {
  lots: Lot[];
}

export type TradeAction = 'buy' | 'sell';

export interface StrategyLogEntry {
  date: string;
  symbol: string;
  action: TradeAction;
  priceJpy: number;
  quantity: number;
  reason: string;
  realizedPnlJpy?: number; // 売りのみ
}

export interface StrategyEquityPoint {
  date: string;
  totalEquityJpy: number;
}

// 2026年9月4日追加: 判断した日の終値でそのまま即約定させると、過去に
// daytrade-sim本体・us-strategy-labで直した「見た値段ではもう買えない」
// look-ahead問題を最初から抱えることになる。このラボは最初からPendingOrder
// 方式（買いは指値、売りは成行）で実装する——詳細はsrc/features/
// us-strategy-lab/types.tsのPendingOrderLabコメントと同じ設計。
export interface PendingOrderLab {
  action: TradeAction;
  quantity?: number; // 'buy'のみ
  limitPriceJpy?: number; // 'buy'のみ。未設定なら成行（翌営業日始値で無条件約定）
  reason: string;
  queuedDate: string;
}

export interface StrategyState {
  cashJpy: number;
  realizedPnlTotalJpy: number;
  positions: Record<string, StrategyPosition>;
  pendingOrders: Record<string, PendingOrderLab>;
  log: StrategyLogEntry[];
  equityHistory: StrategyEquityPoint[];
}

export function createInitialStrategyState(virtualCapitalYen: number): StrategyState {
  return {
    cashJpy: virtualCapitalYen,
    realizedPnlTotalJpy: 0,
    positions: {},
    pendingOrders: {},
    log: [],
    equityHistory: [],
  };
}

export interface LabMeta {
  lastPublishedAt: string | null;
  lastRunDate: string | null; // 同日の重複トリガー対策（1日1回のみのため）
}

export interface SymbolSnapshot {
  symbol: string;
  date: string;
  dayClose: number;
  dailyMovePct: number; // 前日終値 -> 当日終値
  rsi14: number;
  volumeRatio: number;
  sma75: number;
}

export interface StrategySignal {
  action: 'buy' | 'sell' | 'hold' | 'skip';
  quantity?: number; // 'buy'のみ。このラボは戦略ごとに株数を明示する（budgetJpy方式ではない）
  limitPriceJpy?: number; // 'buy'のみ。未設定なら成行
  reason: string;
}

export interface Strategy {
  id: string;
  name: string;
  description: string;
  // openPositionCount: この戦略が現在何銘柄のポジションを持っているか
  // （戦略全体で同時保有枠数に上限を設けるスイングブラケット戦略のような
  // ケースのために、単一銘柄のスナップショットだけでは判断できない情報
  // として渡す）。
  decide(position: StrategyPosition | undefined, snapshot: SymbolSnapshot, allSnapshots: SymbolSnapshot[], openPositionCount: number): StrategySignal;
}
