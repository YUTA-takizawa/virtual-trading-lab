import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLatestEarningsDate, parseValuation } from '../../../src/features/daytrade-sim/fundamentals.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '..', '..', 'fixtures');

function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');
}

describe('parseValuation', () => {
  it('parses PER (会社予想) and PBR (実績) when both are available', () => {
    const html = readFixture('yahoo-finance-jp-quote-5401.html');
    expect(parseValuation(html)).toEqual({ per: 12.45, pbr: 0.64 });
  });

  it('returns undefined for metrics Yahoo renders as "---"', () => {
    const html = readFixture('yahoo-finance-jp-quote-nodata.html');
    expect(parseValuation(html)).toEqual({ per: undefined, pbr: undefined });
  });
});

describe('parseLatestEarningsDate', () => {
  it('parses the most recent earnings date as YYYY-MM-DD', () => {
    const html = readFixture('yahoo-finance-jp-quote-5401.html');
    expect(parseLatestEarningsDate(html)).toBe('2026-08-04');
  });

  it('returns undefined when the page has no earnings-schedule section', () => {
    const html = readFixture('yahoo-finance-jp-quote-nodata.html');
    expect(parseLatestEarningsDate(html)).toBeUndefined();
  });
});
