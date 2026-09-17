// 暗号資産で10種類の異なる売買"手法そのもの"を同一条件（同じ候補16銘柄・
// 同じ市場データ・別会計の仮想元本100万円ずつ）で並行シミュレーションし、
// ダッシュボードで成績を比較するための実験場（2026年8月31日、ユーザー指示）。
// daytrade-sim-crypto/（単一の逆張り戦略）とは別モジュール。Discord通知は
// 行わずダッシュボードのみで比較する方針のため、通知間引きの概念がない代わりに
// ダッシュボード（Cloudflareデプロイ・gitコミット）の更新頻度をlastPublishedAt
// で間引く（15分おきのチェック自体は毎回行うが、公開は約8時間おき）。
//
// 1:2:6ピラミッディングのような特定手法に紐づく建値ロジックをポートフォリオ層
// から追い出し、「1回の買いでbudgetJpy円分を買う」という汎用的な形にした
// （portfolio.ts）。段階的な買い増し方針（1:2:6か、DCAの定額積立か、
// グリッドの均等分割か）は各戦略のdecide()側の責務とする。

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
  realizedPnlJpy?: number; // 売りのみ。税引き前（暗号資産版と同じく雑所得のため税金は計算しない）
  spreadCostJpy?: number;
}

export interface StrategyEquityPoint {
  date: string;
  totalEquityJpy: number;
}

export interface StrategyState {
  cashJpy: number;
  realizedPnlTotalJpy: number;
  spreadCostTotalJpy: number;
  positions: Record<string, StrategyPosition>;
  log: StrategyLogEntry[];
  equityHistory: StrategyEquityPoint[];
}

export function createInitialStrategyState(virtualCapitalYen: number): StrategyState {
  return {
    cashJpy: virtualCapitalYen,
    realizedPnlTotalJpy: 0,
    spreadCostTotalJpy: 0,
    positions: {},
    log: [],
    equityHistory: [],
  };
}

// 10戦略まとめて1つのバッチ実行として扱うため、公開間引きの状態は個々の
// StrategyStateではなくラボ全体で1つだけ持つ（data/crypto-strategy-lab-meta.json）。
export interface LabMeta {
  lastPublishedAt: string | null;
}

// 全16候補銘柄分の指標をまとめて1回だけ計算し、10戦略すべてに同じものを
// 渡す（各戦略は使う指標だけ参照すればよい）。モメンタムランキング戦略
// だけは自分自身の値だけでなく他銘柄との比較が要るため、decide()には
// allSnapshotsも渡す。
export interface SymbolSnapshot {
  symbol: string;
  date: string; // YYYY-MM-DD, JST — 今回のチェック実行日（DCAの積立間隔判定などに使う）
  dayClose: number;
  dailyMovePct: number; // 前日終値 -> 当日終値
  rsi14: number;
  volumeRatio: number;
  sma25: number;
  sma75: number;
  prevSma25: number; // 前日時点のSMA25（移動平均クロスの検知に必要 — 今日と昨日の大小関係の反転を見る）
  prevSma75: number;
  bollingerMid: number; // 20日SMA
  bollingerUpper: number; // 20日SMA + 2σ
  bollingerLower: number; // 20日SMA - 2σ
  highestHigh20: number; // 直近20日の高値
  lowestLow20: number; // 直近20日の安値
  return20dPct: number; // 20日前終値 -> 当日終値（モメンタムランキング用）

  // 2026年8月31日追加: 12戦略拡張分
  sma10: number;
  prevSma10: number; // 3本の移動平均整列（パーフェクトオーダー）の判定に必要
  macd: number;
  macdSignal: number;
  prevMacd: number;
  prevMacdSignal: number; // MACDクロスの検知に必要
  tenkanSen: number; // 一目均衡表・転換線（9日）
  kijunSen: number; // 一目均衡表・基準線（26日）
  prevTenkanSen: number;
  prevKijunSen: number; // 転換線/基準線クロスの検知に必要
  stochK: number; // ストキャスティクス%K
  stochD: number; // ストキャスティクス%D（%Kの3日SMA）
  atr14: number; // 14日ATR（ボラティリティ、ケルトナーチャネル・ブレイクアウトのバンド幅計算にも使用）
  vwap20: number; // 20日出来高加重平均線
  rsi14Prior: number; // 10営業日前時点のRSI14（ダイバージェンス検知用）
  closePrior: number; // 10営業日前の終値（同上）
  dayOfWeek: number; // 0=日曜〜6=土曜（JST、曜日アノマリー戦略用）
}

export interface StrategySignal {
  action: 'buy' | 'sell' | 'hold' | 'skip';
  budgetJpy?: number; // 'buy'のみ。今回いくら分買うかは戦略ごとに決める
  reason: string;
}

export interface Strategy {
  id: string; // ファイル名・state保存キーに使う英数字ID
  name: string; // ダッシュボード表示名
  description: string; // ダッシュボードに出す一言説明
  decide(position: StrategyPosition | undefined, snapshot: SymbolSnapshot, allSnapshots: SymbolSnapshot[]): StrategySignal;
}
