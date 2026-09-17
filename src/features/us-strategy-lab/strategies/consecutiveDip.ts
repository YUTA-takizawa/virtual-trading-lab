import type { Strategy } from '../types.ts';

// 連続陰線カウントだけで機械的に売買する、極めてシンプルな押し目買い。
// RSIやボリンジャーバンドのような統計的指標を一切使わず、「何日連続で
// 下げたか」という価格そのものの並びだけを見る点が他のどの戦略とも異なる。
// 3日連続陰線で買い、陽転（連続陰線が途切れて陽線になる）かつ含み益が
// 出ていたら手仕舞う——曜日アノマリー（dayOfWeek.ts）と同じくカレンダー/
// 価格パターンのみに賭ける素朴な仮説検証枠。SymbolSnapshotは連続陽線の
// カウントは持たないため、手仕舞い条件は「陽線1日＋含み益」というシンプルな
// 反転確認にとどめている（3日連続陰線という強いエントリー条件に対し、あえて
// 手仕舞いは早め・非対称にする設計）。
const MAX_POSITION_USD = 1_000;
const DIP_DAYS_TRIGGER = 3;

export const consecutiveDip: Strategy = {
  id: 'consecutive-dip',
  name: '連続陰線押し目買い',
  description: '3営業日連続で陰線が続いたら機械的に買い、陽転（陰線の連続が途切れて陽線になる）かつ含み益が出ていたら手仕舞う。RSIやボリンジャーバンドなどの統計指標は一切使わない',
  decide(position, s) {
    const hasPosition = Boolean(position) && (position?.lots.length ?? 0) > 0;

    if (!hasPosition) {
      if (s.consecutiveDownDays >= DIP_DAYS_TRIGGER) {
        // 連続陰線で到達した当日終値そのものに指値を置く（それより下がった時だけ拾う）。
        return { action: 'buy', budgetUsd: MAX_POSITION_USD, limitPriceUsd: s.dayClose, reason: `${s.consecutiveDownDays}営業日連続陰線を検知、機械的な押し目買い` };
      }
      return { action: 'skip', reason: '連続陰線が閾値未満' };
    }

    const avgEntry = position!.lots.reduce((sum, l) => sum + l.quantity * l.entryPriceUsd, 0) / position!.lots.reduce((sum, l) => sum + l.quantity, 0);
    const upDayReversal = s.dailyMovePct > 0 && s.consecutiveDownDays === 0;
    if (upDayReversal && s.dayClose > avgEntry) {
      return { action: 'sell', reason: '陽転を確認かつ含み益あり、手仕舞い' };
    }
    return { action: 'hold', reason: '陽転待ち' };
  },
};
