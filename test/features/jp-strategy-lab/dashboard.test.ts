import { describe, expect, it } from 'vitest';
import { buildDashboardData } from '../../../src/features/jp-strategy-lab/dashboard.ts';
import { createInitialStrategyState } from '../../../src/features/jp-strategy-lab/types.ts';
import type { Strategy, StrategyState } from '../../../src/features/jp-strategy-lab/types.ts';

const strategyA: Strategy = { id: 'a', name: 'Strategy A', description: 'desc A', decide: () => ({ action: 'hold', reason: '' }) };
const strategyB: Strategy = { id: 'b', name: 'Strategy B', description: 'desc B', decide: () => ({ action: 'hold', reason: '' }) };

describe('buildDashboardData', () => {
  it('sorts strategies by changePct descending', () => {
    const states: Record<string, StrategyState> = {
      a: { ...createInitialStrategyState(3_000_000), cashJpy: 2_700_000 }, // -10%
      b: { ...createInitialStrategyState(3_000_000), cashJpy: 3_600_000 }, // +20%
    };
    const data = buildDashboardData([strategyA, strategyB], states, {}, [], 3_000_000);

    expect(data.strategies.map((s) => s.id)).toEqual(['b', 'a']);
    expect(data.strategies[0]!.changePct).toBeCloseTo(20, 8);
    expect(data.strategies[1]!.changePct).toBeCloseTo(-10, 8);
  });

  it('surfaces the count of resting (not-yet-filled) pending orders per strategy', () => {
    const pendingOrders = { '7203.T': { action: 'buy' as const, quantity: 100, limitPriceJpy: 2_950, reason: 'test', queuedDate: '2026-09-04' } };
    const states: Record<string, StrategyState> = {
      a: { ...createInitialStrategyState(3_000_000), pendingOrders },
      b: createInitialStrategyState(3_000_000),
    };
    const data = buildDashboardData([strategyA, strategyB], states, {}, [], 3_000_000);

    expect(data.strategies.find((s) => s.id === 'a')!.pendingOrderCount).toBe(1);
    expect(data.strategies.find((s) => s.id === 'b')!.pendingOrderCount).toBe(0);
  });

  it('surfaces the actual pending order details (symbol, price, reason) per strategy, not just a count', () => {
    const pendingOrders = { '7203.T': { action: 'buy' as const, quantity: 100, limitPriceJpy: 2_950, reason: 'test reason', queuedDate: '2026-09-04' } };
    const states: Record<string, StrategyState> = {
      a: { ...createInitialStrategyState(3_000_000), pendingOrders },
      b: createInitialStrategyState(3_000_000),
    };
    const data = buildDashboardData([strategyA, strategyB], states, {}, [{ symbol: '7203.T', name: 'トヨタ自動車' }], 3_000_000);

    expect(data.pendingOrders['a']).toEqual([
      { symbol: '7203.T', name: 'トヨタ自動車', action: 'buy', quantity: 100, limitPriceJpy: 2_950, reason: 'test reason', queuedDate: '2026-09-04' },
    ]);
    expect(data.pendingOrders['b']).toHaveLength(0);
  });

  it('includes per-strategy equity history, positions, and trades keyed by strategy id', () => {
    const positions = { '7203.T': { lots: [{ quantity: 100, entryPriceJpy: 3_000, entryDate: '2026-09-04' }] } };
    const log = [{ date: '2026-09-04', symbol: '7203.T', action: 'buy' as const, priceJpy: 3_000, quantity: 100, reason: 'test' }];
    const states: Record<string, StrategyState> = {
      a: { ...createInitialStrategyState(3_000_000), positions, log, equityHistory: [{ date: '2026-09-04', totalEquityJpy: 3_000_000 }] },
      b: createInitialStrategyState(3_000_000),
    };

    const data = buildDashboardData([strategyA, strategyB], states, { '7203.T': 3_100 }, [{ symbol: '7203.T', name: 'トヨタ自動車' }], 3_000_000);

    expect(data.equityHistories['a']).toHaveLength(1);
    expect(data.positions['a']).toHaveLength(1);
    expect(data.positions['a']![0]!.name).toBe('トヨタ自動車');
    expect(data.trades['a']).toHaveLength(1);
    expect(data.positions['b']).toHaveLength(0);
  });
});
