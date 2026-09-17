import { describe, expect, it } from 'vitest';
import { buildDashboardData } from '../../../src/features/crypto-strategy-lab/dashboard.ts';
import { createInitialStrategyState } from '../../../src/features/crypto-strategy-lab/types.ts';
import type { Strategy, StrategyState } from '../../../src/features/crypto-strategy-lab/types.ts';

const strategyA: Strategy = { id: 'a', name: 'Strategy A', description: 'desc A', decide: () => ({ action: 'hold', reason: '' }) };
const strategyB: Strategy = { id: 'b', name: 'Strategy B', description: 'desc B', decide: () => ({ action: 'hold', reason: '' }) };

describe('buildDashboardData', () => {
  it('sorts strategies by changePct descending', () => {
    const states: Record<string, StrategyState> = {
      a: { ...createInitialStrategyState(1_000_000), cashJpy: 900_000 }, // -10%
      b: { ...createInitialStrategyState(1_000_000), cashJpy: 1_200_000 }, // +20%
    };
    const data = buildDashboardData([strategyA, strategyB], states, {}, [], 1_000_000);

    expect(data.strategies.map((s) => s.id)).toEqual(['b', 'a']);
    expect(data.strategies[0]!.changePct).toBeCloseTo(20, 8);
    expect(data.strategies[1]!.changePct).toBeCloseTo(-10, 8);
  });

  it('includes per-strategy equity history, positions, and trades keyed by strategy id', () => {
    const positions = { 'BTC-JPY': { lots: [{ quantity: 1, entryPriceJpy: 1_000_000, entryDate: '2026-08-31' }] } };
    const log = [{ date: '2026-08-31', symbol: 'BTC-JPY', action: 'buy' as const, priceJpy: 1_000_000, quantity: 1, reason: 'test' }];
    const states: Record<string, StrategyState> = {
      a: { ...createInitialStrategyState(1_000_000), positions, log, equityHistory: [{ date: '2026-08-31', totalEquityJpy: 1_000_000 }] },
      b: createInitialStrategyState(1_000_000),
    };

    const data = buildDashboardData([strategyA, strategyB], states, { 'BTC-JPY': 1_100_000 }, [{ symbol: 'BTC-JPY', name: 'ビットコイン' }], 1_000_000);

    expect(data.equityHistories['a']).toHaveLength(1);
    expect(data.positions['a']).toHaveLength(1);
    expect(data.positions['a']![0]!.name).toBe('ビットコイン');
    expect(data.trades['a']).toHaveLength(1);
    expect(data.positions['b']).toHaveLength(0);
  });
});
