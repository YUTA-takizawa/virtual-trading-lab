export interface DaytradeThresholds {
  morningCrashPct: number;
  morningSurgePct: number;
  afternoonSurgePct: number;
  flatDayPct: number;
  rsiBuyConfirmMax: number; // 朝の急落を「買い」と確認するにはRSI14がこの値未満である必要がある（earningsAnnouncedTodayなら免除）
  rsiSellConfirmMin: number; // 午後の急騰を「利確」と確認するにはRSI14がこの値以上である必要がある
  volumeRatioMin: number;
  perMax: number; // PER上限（会社予想）。新規買いのフィルタに使用。データ未取得時は素通し（fail-open）
  pbrMax: number; // PBR上限（実績）。同上
  stopLossPct: number; // 0または未設定なら無効。平均取得単価からの下落率がこれを超えたら強制手仕舞い
  tranche2ConfirmPct: number; // tranche2（追撃買い）を入れる、平均取得単価からの上昇率のしきい値
}

export interface DaytradeCandidate {
  symbol: string;
  name: string;
}

export interface DaytradeConfig {
  note?: string;
  virtualCapitalYen: number;
  maxPositionYen: number; // 1銘柄あたりの上限（tranche1+2+3の合計）
  marginMultiplier: number; // 1 = 現物同等（レバレッジなし）。>1で信用取引相当のレバレッジをかける
  thresholds: DaytradeThresholds;
  items: DaytradeCandidate[];
}

export interface PositionTranche {
  trancheNumber: 1 | 2 | 3;
  shares: number;
  entryPrice: number;
  entryDate: string; // YYYY-MM-DD, JST
}

export interface DaytradePosition {
  tranches: PositionTranche[]; // 1〜3件、常にtrancheNumber昇順
}

export type TradeAction = 'buy' | 'sell';

export type DecisionAction = TradeAction | 'hold' | 'skip';

export interface RuleInputs {
  hasPosition: boolean;
  tranchesHeld: 0 | 1 | 2 | 3;
  avgEntryPrice: number; // 0 when hasPosition is false
  lastTrancheEntryPrice: number; // 0 when hasPosition is false
  // True only when the most recent tranche was added on an earlier trading day than today —
  // pyramiding never adds a second tranche on the same day it opened the position.
  canPyramidToday: boolean;
  morningMovePct: number;
  afternoonMovePct: number;
  fullDayMovePct: number;
  dayClose: number;
  sma75: number; // 75-day SMA of daily closes — trend filter (buy only above it) and trend-break exit (sell if dayClose falls below it while holding)
  rsi14: number;
  volumeRatio: number;
  per?: number; // undefined = データ取得不可（fail-open で通す）
  pbr?: number;
  earningsAnnouncedToday: boolean;
}

export interface RuleSignal {
  action: DecisionAction;
  reason: string;
  // Which tranche a 'buy' signal is for (1:2:6 pyramiding). Unset for 'sell'
  // (always closes every tranche at once — no partial exits).
  trancheNumber?: 1 | 2 | 3;
  // 2026年9月1日追加: tranche1（急落での打診買い）のみ設定される、本物の指値
  // 目標価格。ユーザーから「その日の安いときに買うのが理想では」との指摘を
  // 受け、成行（次セッションの始値で無条件約定）だけでなく、急落を確認した
  // その価格（inputs.dayClose）に実際の指値を置き、次セッションの安値がそこ
  // まで下がった場合にのみ約定させる方式にした。tranche2/3（追撃買い・本
  // 買い）は「上昇を確認して乗る」順張り的な買い増しのため、押し目を待つと
  // 前提と矛盾する——成行のまま据え置く（詳細はrules.tsのdecideWhileFlat参照）。
  limitPrice?: number;
}

// A buy/sell decided this session but not yet filled. Real orders can't
// execute at a price already printed (you can't place a market order after
// 前場引け and get filled at 前場引け's price) — the earliest realistic fill
// is the *next* session's open, so index.ts queues the signal here instead
// of applying it immediately, and fills it on the following session's run
// (dayOpen if that's a morning run, afternoonOpen if afternoon — see
// index.ts). At most one pending order per symbol: each run drains any
// pending order for a symbol before it can queue a new one.
export interface PendingOrder {
  action: TradeAction;
  trancheNumber?: 1 | 2 | 3; // only for 'buy'
  // 'buy'のみ。未設定なら成行（次セッションの始値で無条件約定）。設定時は
  // 指値注文——次セッションの安値（morningLow/afternoonLow）がこの価格以下
  // まで下がった回にのみ約定し、それまでは同じ銘柄への新規判断を行わず
  // 発注済みのまま持ち越す（LIMIT_ORDER_EXPIRY_DAYS経過で失効、index.ts参照）。
  limitPrice?: number;
  reason: string;
  queuedDate: string; // YYYY-MM-DD, JST — when the signal fired, for audit only (the fill itself is dated with the fill run's date)
}

export interface DaytradeLogEntry {
  date: string; // YYYY-MM-DD, JST
  symbol: string;
  action: TradeAction;
  price: number;
  shares: number;
  reason: string;
  trancheNumber?: 1 | 2 | 3; // only present for 'buy' entries
  realizedPnl?: number; // only present for 'sell' entries — gross, before tax
  tax?: number; // only present for 'sell' entries — 0 on a losing trade, otherwise realizedPnl * TAX_RATE_ON_GAINS
}

export type DaytradeSession = 'morning' | 'afternoon';

export interface EquityPoint {
  date: string; // YYYY-MM-DD, JST
  session: DaytradeSession;
  totalEquity: number; // cash + mark-to-market value of open positions at the time this run finished
}

export interface DaytradeState {
  cash: number; // may go negative when marginMultiplier > 1 — represents margin debt (no interest/maintenance-margin modeled)
  realizedPnlTotal: number; // cumulative gross realized P&L, before tax
  taxPaidTotal: number; // cumulative tax withheld on winning trades (see TAX_RATE_ON_GAINS in portfolio.ts)
  commissionPaidTotal: number; // cumulative 立花証券e支店 daily flat commission (see calcDailyCommission in portfolio.ts), charged once per day at the afternoon session
  positions: Record<string, DaytradePosition>;
  pendingOrders: Record<string, PendingOrder>; // symbol -> order queued last run, filled at the start of this run before new signals are evaluated
  // lastRunDate/lastRunSession record only the most recently completed run and
  // are kept for the dashboard's "last updated" display — they are NOT enough
  // to guard against double-processing on their own. A GitHub Actions native
  // `schedule:` cron fire can arrive hours late (the local Windows Task
  // Scheduler trigger is the reliable one; native cron is just a backup, see
  // README), so a stale morning-labeled run can show up *after* that day's
  // afternoon run already completed — `lastRunSession === 'afternoon'` no
  // longer matches `session === 'morning'`, so the naive check would let it
  // through and reprocess morning a second time with post-market-close data
  // (observed 2026-09-16, a 17:19 JST "morning" report). lastMorningRunDate/
  // lastAfternoonRunDate track each session's completion independently so a
  // delayed duplicate of either is always caught regardless of what ran after it.
  lastRunDate: string | null;
  lastRunSession: DaytradeSession | null;
  lastMorningRunDate: string | null;
  lastAfternoonRunDate: string | null;
  log: DaytradeLogEntry[];
  equityHistory: EquityPoint[]; // one point per run, oldest first — powers the Discord equity-curve chart
}

export function createInitialState(virtualCapitalYen: number): DaytradeState {
  return {
    cash: virtualCapitalYen,
    realizedPnlTotal: 0,
    taxPaidTotal: 0,
    commissionPaidTotal: 0,
    positions: {},
    pendingOrders: {},
    lastRunDate: null,
    lastRunSession: null,
    lastMorningRunDate: null,
    lastAfternoonRunDate: null,
    log: [],
    equityHistory: [],
  };
}
