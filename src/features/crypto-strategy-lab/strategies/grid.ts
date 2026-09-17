import type { Strategy } from '../types.ts';
import { avgEntryPriceJpy } from '../portfolio.ts';

// グリッドトレード: 75日移動平均を基準線とし、そこから下にGRID_STEP_PCT刻みの
// ライン（3%下、6%下、9%下…）を仮想的に引く。価格が新しいラインに触れる
// たびに均等額を買い増し、平均取得単価から一定幅戻ったら全部売って利確する
// —— レンジ相場・往来相場で強い手法とされる。トレンドの有無を判定しない点が
// 他の戦略と異なる。
const MAX_POSITION_YEN = 100_000;
const GRID_LEVELS = 6; // 100,000円を6ラインに分割
const BUY_AMOUNT_JPY = MAX_POSITION_YEN / GRID_LEVELS;
const GRID_STEP_PCT = 3;
const SELL_MARGIN_PCT = 4.5; // 平均取得単価からこの%戻ったら利確（グリッド1.5段分相当）

export const grid: Strategy = {
  id: 'grid',
  name: 'グリッドトレード',
  description: '75日移動平均から3%刻みで下に引いた仮想グリッドラインに触れるたびに買い増し、平均取得単価+4.5%で利確',
  decide(position, s) {
    const lots = position?.lots ?? [];
    const step = GRID_STEP_PCT / 100;

    if (lots.length > 0) {
      const avgEntry = avgEntryPriceJpy({ lots });
      if (s.dayClose >= avgEntry * (1 + SELL_MARGIN_PCT / 100)) {
        return { action: 'sell', reason: `平均取得単価比+${SELL_MARGIN_PCT}%に到達、グリッド利確` };
      }
    }

    if (lots.length >= GRID_LEVELS) {
      return { action: 'hold', reason: '全グリッド段階を買い終えた、利確待ち' };
    }

    // 現在値が基準線から何段下にいるか（下にいなければ0以下）
    const levelBelow = Math.floor((s.sma75 - s.dayClose) / (s.sma75 * step));
    if (levelBelow < 1) {
      return { action: 'skip', reason: '基準線付近、グリッドライン未到達' };
    }
    const gridLinePrice = s.sma75 * (1 - levelBelow * step);
    const alreadyBoughtThisLevel = lots.some((l) => Math.abs(l.entryPriceJpy - gridLinePrice) / gridLinePrice < step / 2);
    if (alreadyBoughtThisLevel) {
      return { action: 'hold', reason: `${levelBelow}段目のラインはすでに買い済み` };
    }
    return { action: 'buy', budgetJpy: BUY_AMOUNT_JPY, reason: `基準線から${levelBelow}段目（${GRID_STEP_PCT * levelBelow}%下）のグリッドラインに到達、買い増し` };
  },
};
