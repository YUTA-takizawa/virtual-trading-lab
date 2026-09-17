import { describe, expect, it } from 'vitest';
import { buildDashboardData } from '../../../src/features/us-strategy-lab/dashboard.ts';
import { createInitialStrategyState } from '../../../src/features/us-strategy-lab/types.ts';
import type { Strategy, StrategyState } from '../../../src/features/us-strategy-lab/types.ts';

const strategyA: Strategy = { id: 'a', name: 'Strategy A', description: 'desc A', decide: () => ({ action: 'hold', reason: '' }) };
const strategyB: Strategy = { id: 'b', name: 'Strategy B', description: 'desc B', decide: () => ({ action: 'hold', reason: '' }) };

describe('buildDashboardData', () => {
  it('sorts strategies by changePct descending', () => {
    const states: Record<string, StrategyState> = {
      a: { ...createInitialStrategyState(10_000), cashUsd: 9_000 }, // -10%
      b: { ...createInitialStrategyState(10_000), cashUsd: 12_000 }, // +20%
    };
    const data = buildDashboardData([strategyA, strategyB], states, {}, [], 10_000);

    expect(data.strategies.map((s) => s.id)).toEqual(['b', 'a']);
    expect(data.strategies[0]!.changePct).toBeCloseTo(20, 8);
    expect(data.strategies[1]!.changePct).toBeCloseTo(-10, 8);
  });

  it('surfaces the count of resting (not-yet-filled) pending orders per strategy', () => {
    const pendingOrders = { AAPL: { action: 'buy' as const, budgetUsd: 1_000, limitPriceUsd: 190, reason: 'test', queuedDate: '2026-09-01' } };
    const states: Record<string, StrategyState> = {
      a: { ...createInitialStrategyState(10_000), pendingOrders },
      b: createInitialStrategyState(10_000),
    };
    const data = buildDashboardData([strategyA, strategyB], states, {}, [], 10_000);

    expect(data.strategies.find((s) => s.id === 'a')!.pendingOrderCount).toBe(1);
    expect(data.strategies.find((s) => s.id === 'b')!.pendingOrderCount).toBe(0);
  });

  it('includes per-strategy equity history, positions, and trades keyed by strategy id', () => {
    const positions = { AAPL: { lots: [{ quantity: 1, entryPriceUsd: 200, entryDate: '2026-09-01' }] } };
    const log = [{ date: '2026-09-01', symbol: 'AAPL', action: 'buy' as const, priceUsd: 200, quantity: 1, reason: 'test' }];
    const states: Record<string, StrategyState> = {
      a: { ...createInitialStrategyState(10_000), positions, log, equityHistory: [{ date: '2026-09-01', totalEquityUsd: 10_000 }] },
      b: createInitialStrategyState(10_000),
    };

    const data = buildDashboardData([strategyA, strategyB], states, { AAPL: 220 }, [{ symbol: 'AAPL', name: 'Apple' }], 10_000);

    expect(data.equityHistories['a']).toHaveLength(1);
    expect(data.positions['a']).toHaveLength(1);
    expect(data.positions['a']![0]!.name).toBe('Apple');
    expect(data.trades['a']).toHaveLength(1);
    expect(data.positions['b']).toHaveLength(0);
  });
});
