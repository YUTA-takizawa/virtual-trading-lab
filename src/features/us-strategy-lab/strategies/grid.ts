import type { Strategy } from '../types.ts';
import { avgEntryPriceUsd } from '../portfolio.ts';

const MAX_POSITION_USD = 1_000;
const GRID_LEVELS = 6;
const BUY_AMOUNT_USD = MAX_POSITION_USD / GRID_LEVELS;
const GRID_STEP_PCT = 3;
const SELL_MARGIN_PCT = 4.5;

export const grid: Strategy = {
  id: 'grid',
  name: 'グリッドトレード',
  description: '75日移動平均から3%刻みで下に引いた仮想グリッドラインに触れるたびに買い増し、平均取得単価+4.5%で利確',
  decide(position, s) {
    const lots = position?.lots ?? [];
    const step = GRID_STEP_PCT / 100;

    if (lots.length > 0) {
      const avgEntry = avgEntryPriceUsd({ lots });
      if (s.dayClose >= avgEntry * (1 + SELL_MARGIN_PCT / 100)) {
        return { action: 'sell', reason: `平均取得単価比+${SELL_MARGIN_PCT}%に到達、グリッド利確` };
      }
    }

    if (lots.length >= GRID_LEVELS) {
      return { action: 'hold', reason: '全グリッド段階を買い終えた、利確待ち' };
    }

    const levelBelow = Math.floor((s.sma75 - s.dayClose) / (s.sma75 * step));
    if (levelBelow < 1) {
      return { action: 'skip', reason: '基準線付近、グリッドライン未到達' };
    }
    const gridLinePrice = s.sma75 * (1 - levelBelow * step);
    const alreadyBoughtThisLevel = lots.some((l) => Math.abs(l.entryPriceUsd - gridLinePrice) / gridLinePrice < step / 2);
    if (alreadyBoughtThisLevel) {
      return { action: 'hold', reason: `${levelBelow}段目のラインはすでに買い済み` };
    }
    // グリッドライン自体が指値の水準（グリッドトレードは本来、指値注文を等間隔に並べて置く手法）。
    return { action: 'buy', budgetUsd: BUY_AMOUNT_USD, limitPriceUsd: gridLinePrice, reason: `基準線から${levelBelow}段目（${GRID_STEP_PCT * levelBelow}%下）のグリッドラインに到達、買い増し` };
  },
};
