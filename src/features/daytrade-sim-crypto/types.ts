// 暗号資産版（GMOコイン現物取引・販売所を前提）。米国株版
// （src/features/daytrade-sim-us/）との主な違い:
// - 暗号資産は土日含め24時間365日取引されるため、曜日を問わず15分おきに
//   売買判定（チェック）だけを行う（2026年8月30日、ユーザー指示によりチェック
//   頻度と通知頻度を分離）。Discord通知はチェックのたびに送るとスパムになる
//   ため、前回の通知から8時間以上経過した回だけ追加で送る（1日3回程度。
//   8は24を割り切るため通知時刻が日々ドリフトせず一定のリズムに収束する）。
//   「毎日07:00/23:00ちょうどに通知」のような時刻固定にしなかったのは、GitHub Actionsの
//   cronが何時間も遅延することが実際にあり（daytrade-sim.ymlで発生済み）、
//   時刻固定だとその回の通知が丸ごと抜けるリスクがあるため。経過時間ベース
//   なら遅延しても次のチェックで必ず拾える（src/features/daytrade-sim-crypto/
//   index.tsのNOTIFY_INTERVAL_HOURS参照）
// - 円建てティッカー（例: BTC-JPY）をそのまま使うため、為替換算は不要
//   （cash・price・全て円建てで完結）
// - GMOコインの現物取引「販売所」は手数料無料だがスプレッド（売値と買値の差）
//   が実質コストとして発生する。正確な料率は非公開のため近似値でモデル化
//   （src/features/daytrade-sim-crypto/portfolio.tsのSPREAD_PCT参照）
// - 暗号資産の利益は雑所得（総合課税、5%〜45%の累進税率）で個人の所得水準
//   依存のため一律課税できず、税金は計算しない（常に税引き前で表示）

export interface DaytradeCryptoThresholds {
  crashPct: number; // 前日終値比でこの%以上下落したら「急落」（新規買いのトリガー）
  surgePct: number; // 保有中に前日終値比でこの%以上上昇したら「急騰」（利確のトリガー）
  flatDayPct: number; // この%未満の値動きは「方向感のない日」として新規買いを見送る
  rsiBuyConfirmMax: number;
  rsiSellConfirmMin: number;
  volumeRatioMin: number;
  stopLossPct: number; // 0または未設定なら無効
  tranche2ConfirmPct: number;
}

export interface DaytradeCryptoCandidate {
  symbol: string; // Yahoo Financeティッカー（例: "BTC-JPY"）
  name: string;
}

export interface DaytradeCryptoConfig {
  note?: string;
  virtualCapitalYen: number;
  maxPositionYen: number; // 1銘柄あたりの取得コスト上限
  marginMultiplier: number;
  thresholds: DaytradeCryptoThresholds;
  items: DaytradeCryptoCandidate[];
}

export interface PositionTrancheCrypto {
  trancheNumber: 1 | 2 | 3;
  quantity: number; // 数量（端数可、QUANTITY_PRECISIONで丸め）
  entryPriceJpy: number;
  entryDate: string; // YYYY-MM-DD, JST
}

export interface DaytradeCryptoPosition {
  tranches: PositionTrancheCrypto[];
}

export type TradeAction = 'buy' | 'sell';
export type DecisionAction = TradeAction | 'hold' | 'skip';

export interface RuleInputsCrypto {
  hasPosition: boolean;
  tranchesHeld: 0 | 1 | 2 | 3;
  avgEntryPriceJpy: number; // 0 when hasPosition is false
  lastTrancheEntryPriceJpy: number; // 0 when hasPosition is false
  canPyramidToday: boolean;
  dailyMovePct: number; // 前日終値 -> 現在値
  dayClose: number; // 現在値（円）
  sma75: number; // 75日移動平均（円）
  rsi14: number;
  volumeRatio: number;
}

export interface RuleSignalCrypto {
  action: DecisionAction;
  reason: string;
  trancheNumber?: 1 | 2 | 3;
}

export type DaytradeCryptoSession = 'morning' | 'night';

export interface DaytradeCryptoLogEntry {
  date: string;
  symbol: string;
  action: TradeAction;
  priceJpy: number;
  quantity: number;
  reason: string;
  trancheNumber?: 1 | 2 | 3;
  realizedPnlJpy?: number; // 売りのみ。税引き前
  spreadCostJpy?: number; // 売買どちらにも発生（実行価格に織り込み済みだが内訳として記録）
}

export interface EquityPointCrypto {
  date: string;
  session: DaytradeCryptoSession;
  totalEquityJpy: number;
}

export interface DaytradeCryptoState {
  cashJpy: number;
  realizedPnlTotalJpy: number; // 累計・税引き前
  spreadCostTotalJpy: number; // 累計スプレッドコスト（参考値、realizedPnlJpyには既に反映済み）
  positions: Record<string, DaytradeCryptoPosition>;
  // 15分おきのチェックは毎回状態を更新しうるが、Discord通知は間引く
  // （index.tsのNOTIFY_INTERVAL_HOURS）。lastNotifiedAtは最後に通知した
  // 時刻（ISO、経過時間の判定に使用）、lastNotifiedLogCountはその時点での
  // logの長さ（次回通知時に「前回通知以降の新規取引」だけを報告するための
  // 目印。チェックごとのsessionTrades方式から変更）。
  lastNotifiedAt: string | null;
  lastNotifiedLogCount: number;
  log: DaytradeCryptoLogEntry[];
  equityHistory: EquityPointCrypto[]; // Discord埋め込みの折れ線グラフ専用。通知のたびに1点（8時間おき） — 既存のチャート密度を維持
  // Webダッシュボードはより細かく見たいというユーザー要望（2026年8月31日）を
  // 受けて、Discord通知（8時間おき）とは切り離し1時間おきに公開する。その
  // ための専用の資産推移・公開時刻（index.tsのDASHBOARD_PUBLISH_INTERVAL_HOURS）。
  dashboardEquityHistory: EquityPointCrypto[];
  lastDashboardPublishedAt: string | null;
}

export function createInitialCryptoState(virtualCapitalYen: number): DaytradeCryptoState {
  return {
    cashJpy: virtualCapitalYen,
    realizedPnlTotalJpy: 0,
    spreadCostTotalJpy: 0,
    positions: {},
    lastNotifiedAt: null,
    lastNotifiedLogCount: 0,
    log: [],
    equityHistory: [],
    dashboardEquityHistory: [],
    lastDashboardPublishedAt: null,
  };
}
