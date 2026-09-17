import { describe, expect, it } from 'vitest';
import { calcConsecutiveDownDays } from '../../../src/features/us-strategy-lab/indicators.ts';

// The rest of indicators.ts is re-exported as-is from crypto-strategy-lab/indicators.ts
// (already covered by test/features/crypto-strategy-lab/indicators.test.ts) — only the
// new calcConsecutiveDownDays helper needs its own coverage here.
describe('calcConsecutiveDownDays', () => {
  it('counts trailing consecutive down-days', () => {
    expect(calcConsecutiveDownDays([100, 110, 108, 105, 102])).toBe(3);
  });

  it('returns 0 when the latest day is not down', () => {
    expect(calcConsecutiveDownDays([100, 90, 95])).toBe(0);
  });

  it('returns 0 for a single-element array', () => {
    expect(calcConsecutiveDownDays([100])).toBe(0);
  });

  it('counts the entire trailing streak when every day but the first is down', () => {
    expect(calcConsecutiveDownDays([100, 90, 80, 70])).toBe(3);
  });
});
