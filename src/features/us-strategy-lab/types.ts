// 米国株版の戦略比較ラボ（2026年9月1日、ユーザー指示: 「米国株の比較も見たい
// 30件ていど欲しい」「とんでもない買い方でもなんでもいい」「購入時間も特に
// 決めない(スイングでもデイトレでも)」「円建て、ドル建てのどちらでもいいが、
// 儲かることがすべてだ」）。src/features/crypto-strategy-lab/と同じ設計思想
// （銘柄横断で同一の指標セットを1回だけ計算し、複数の独立した"手法そのもの"
// を同一条件・別会計で並行シミュレーションしてダッシュボードで比較する）を
// 踏襲するが、以下の点が異なる:
// - 通貨: ユーザーが「円建て、ドル建てのどちらでもいい」と明言したため、
//   このラボは一貫してUSD建てで運用する。daytrade-sim-usのような円⇔ドル
//   往復スプレッド・為替レート取得は行わない（30戦略×毎日のFX反映は複雑さに
//   見合わない）。米国株の売却時に実在するSEC/FINRA手数料はportfolio.tsで
//   daytrade-sim-usの実装を再利用する。
// - 候補銘柄: config/daytrade-us.json（NYダウ30・NASDAQ100、計122銘柄）を
//   そのまま流用する（二重管理を避けるため、crypto-strategy-labがdaytrade-
//   crypto.jsonを流用するのと同じ考え方）。
// - チェック頻度: 米国株の日足データは1日1回しか更新されないため、
//   crypto-strategy-labのような「15分おきにチェック・公開は間引く」方式は
//   不要。daytrade-sim-usと同じく1日1回の実行で完結する（index.ts）。

export interface Lot {
  quantity: number;
  entryPriceUsd: number;
  entryDate: string; // YYYY-MM-DD, JST（実行環境の日付。米国市場のET基準ではない点はdaytrade-sim-usと同じ簡略化）
}

export interface StrategyPosition {
  lots: Lot[];
}

export type TradeAction = 'buy' | 'sell';

export interface StrategyLogEntry {
  date: string;
  symbol: string;
  action: TradeAction;
  priceUsd: number;
  quantity: number;
  reason: string;
  realizedPnlUsd?: number; // 売りのみ。SEC/FINRA手数料控除後
  feesUsd?: number; // 売りのみ（SEC Fee + FINRA Fee）
}

export interface StrategyEquityPoint {
  date: string;
  totalEquityUsd: number;
}

// 2026年9月1日追加: 「その日の終値を見て、その終値でそのまま即約定」は
// 過去に日本株版・米国株版本体で直した非現実的なパターン（見た値段では
// もう買えない）と同じ問題をこのラボにも抱えていた。ユーザーからの指摘
// （「米国株もその日の安いときに買うのが理想では？」）を受け、単に翌営業日
// 始値まで約定を遅らせる（成行）だけでなく、戦略が明示的な目標価格を計算
// している場合はその価格に本物の指値注文として発注し、翌営業日の安値が
// その指値に達した場合のみ約定させる方式にした。ブレイクアウト・クロス系
// （価格が「上に抜けた」ことそのものが根拠の戦略）は押し目を待つと戦略の
// 前提と矛盾するため、指値ではなく成行（翌営業日始値で無条件約定）のまま。
export interface PendingOrderLab {
  action: TradeAction;
  budgetUsd?: number; // 'buy'のみ
  limitPriceUsd?: number; // 'buy'のみ。未指定なら成行（翌営業日始値で無条件約定）、指定ありなら翌営業日の安値がこの価格以下になった回にのみ約定（指値以下では約定しない、指値かそれより良い価格＝始値がさらに低ければその始値で約定）
  reason: string;
  queuedDate: string; // YYYY-MM-DD, JST — この注文を発注した（decide()がbuy/sellを返した）日
}

export interface StrategyState {
  cashUsd: number;
  realizedPnlTotalUsd: number;
  feesPaidTotalUsd: number;
  positions: Record<string, StrategyPosition>;
  pendingOrders: Record<string, PendingOrderLab>; // symbol -> 発注済みだがまだ約定していない注文
  log: StrategyLogEntry[];
  equityHistory: StrategyEquityPoint[];
}

export function createInitialStrategyState(virtualCapitalUsd: number): StrategyState {
  return {
    cashUsd: virtualCapitalUsd,
    realizedPnlTotalUsd: 0,
    feesPaidTotalUsd: 0,
    positions: {},
    pendingOrders: {},
    log: [],
    equityHistory: [],
  };
}

// 30戦略まとめて1つのバッチ実行として扱うため、公開状態はラボ全体で1つだけ
// 持つ（data/us-strategy-lab-meta.json）。1日1回しか実行しないため
// crypto-strategy-labのような時間ベースの間引きは行わず、実行のたびに
// 常に公開する（lastPublishedAtは記録のみに使う）。lastRunDateはGitHubの
// scheduleトリガーの遅延対策として併用するWindows Task Schedulerからの
// workflow_dispatchと、GitHub自身のcronが同日に重複発火した場合に二重に
// 売買処理してしまわないためのガード（daytrade-sim/daytrade-sim-usの
// lastRunDateと同じ考え方）。
export interface LabMeta {
  lastPublishedAt: string | null;
  lastRunDate: string | null;
}

// 候補122銘柄分の指標をまとめて1回だけ計算し、30戦略すべてに同じものを渡す。
// 一部の戦略（モメンタムランキング・低ボラティリティ選好・値幅ランキング・
// 相対強弱ペア）は他銘柄との比較が要るため、decide()にはallSnapshotsも渡す。
export interface SymbolSnapshot {
  symbol: string;
  date: string;
  dayClose: number;
  dayOpen: number; // 当日の始値（ギャップ戦略用）
  prevClose: number; // 前日終値（ギャップ%の算出に使う）
  dailyMovePct: number; // 前日終値 -> 当日終値
  gapPct: number; // 前日終値 -> 当日始値（寄り付きのギャップ）
  rsi14: number;
  rsi14Prior: number; // 10営業日前時点のRSI14（ダイバージェンス検知用）
  closePrior: number; // 10営業日前の終値（同上）
  volumeRatio: number;
  consecutiveDownDays: number;

  sma10: number;
  prevSma10: number;
  sma25: number;
  prevSma25: number;
  sma50: number;
  prevSma50: number;
  sma75: number;
  prevSma75: number;
  sma200: number;
  prevSma200: number;

  bollingerMid: number;
  bollingerUpper: number;
  bollingerLower: number;
  highestHigh20: number;
  lowestLow20: number;
  highestHigh200: number; // 約200営業日（およそ1年）の最高値、長期ブレイクアウト用
  return20dPct: number;

  macd: number;
  macdSignal: number;
  prevMacd: number;
  prevMacdSignal: number;
  tenkanSen: number;
  kijunSen: number;
  prevTenkanSen: number;
  prevKijunSen: number;
  stochK: number;
  stochD: number;
  atr14: number;
  vwap20: number;
  dayOfWeek: number;
}

export interface StrategySignal {
  action: 'buy' | 'sell' | 'hold' | 'skip';
  budgetUsd?: number; // 'buy'のみ
  limitPriceUsd?: number; // 'buy'のみ。戦略が明示的な目標価格（ボリンジャー下限・VWAP乖離目標・グリッドライン等）を持つ場合のみ設定。未設定なら成行として扱う
  reason: string;
}

export interface Strategy {
  id: string;
  name: string;
  description: string;
  decide(position: StrategyPosition | undefined, snapshot: SymbolSnapshot, allSnapshots: SymbolSnapshot[]): StrategySignal;
}
