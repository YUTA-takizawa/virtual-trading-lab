import { describe, expect, it } from 'vitest';
import { joinWithinFieldLimit } from '../../src/shared/discordClient.ts';

describe('joinWithinFieldLimit', () => {
  it('joins short lists as-is with the default 1024/newline behavior', () => {
    expect(joinWithinFieldLimit(['a', 'b', 'c'])).toBe('a\nb\nc');
  });

  it('truncates with a "…ほかN件" marker once the default limit is exceeded', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line-${i}`);
    const result = joinWithinFieldLimit(lines);
    expect(result.length).toBeLessThanOrEqual(1024);
    expect(result).toMatch(/…ほか\d+件$/);
  });

  it('respects a custom limit and separator', () => {
    // Regression test for the 2026-09-17 incident: hundreds of failed
    // symbols joined with '・' into embed.description (limit 4096) crashed
    // the whole Discord post with a 400 because the unbounded join blew
    // past the limit.
    const symbols = Array.from({ length: 500 }, (_, i) => `銘柄${i} (${1000 + i}.T)`);
    const result = joinWithinFieldLimit(symbols, 200, '・');
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result).toMatch(/…ほか\d+件$/);
  });

  it('does not truncate when the custom limit comfortably fits the input', () => {
    expect(joinWithinFieldLimit(['x', 'y'], 4096, '・')).toBe('x・y');
  });
});
