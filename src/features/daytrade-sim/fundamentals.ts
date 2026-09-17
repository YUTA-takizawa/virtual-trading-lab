import * as cheerio from 'cheerio';
import { politeFetch } from '../../scrapers/base.ts';

/**
 * PER/PBR come from Yahoo!ファイナンス's public per-stock page rather than
 * an API — Yahoo Finance's quote/quoteSummary endpoints (which do expose
 * these) now require an auth crumb (verified: 401 "Invalid Crumb" without
 * one), unlike the unauthenticated v8 chart API marketData.ts uses. This
 * page is public HTML with no auth, but its CSS-module class names are
 * hashed (e.g. `_DataListItem__value_13tc9_71`) and can change on any Yahoo
 * deploy — same fragility class as src/scrapers/suumo.ts. Re-verify against
 * the fixtures under test/fixtures/yahoo-finance-jp-quote-*.html if this
 * starts returning undefined for stocks that should have data.
 *
 * 『会社四季報』(Toyo Keizai's Shikiho) is a paid, copyrighted publication —
 * its commentary/growth-story content is never scraped or reproduced here.
 * Only the plain PER/PBR numbers (public data, not Shikiho-exclusive) are used.
 */
export async function fetchFundamentalsPage(symbol: string): Promise<string> {
  return politeFetch(`https://finance.yahoo.co.jp/quote/${encodeURIComponent(symbol)}`);
}

function extractLabeledValue($: cheerio.CheerioAPI, nameLabel: string, subLabel: string): number | undefined {
  let result: number | undefined;
  $('dt').each((_, dt) => {
    const $dt = $(dt);
    const text = $dt.text();
    if (!text.includes(nameLabel) || !text.includes(subLabel)) {
      return;
    }
    const valueText = $dt.siblings('dd').find('[class*="StyledNumber__value"]').first().text().trim();
    const parsed = Number.parseFloat(valueText.replace(/,/g, ''));
    if (Number.isFinite(parsed)) {
      result = parsed;
    }
    return false; // stop iterating once the matching dt is found
  });
  return result;
}

export interface Valuation {
  per?: number; // 会社予想PER, in multiples (e.g. 12.45)
  pbr?: number; // 実績PBR, in multiples (e.g. 0.64)
}

/** Parses 会社予想PER and 実績PBR from a Yahoo!ファイナンス quote page. Returns undefined for a metric Yahoo renders as "---" (no forecast/data). */
export function parseValuation(html: string): Valuation {
  const $ = cheerio.load(html);
  return {
    per: extractLabeledValue($, 'PER', '（会社予想）'),
    pbr: extractLabeledValue($, 'PBR', '（実績）'),
  };
}

const EARNINGS_DATE_PATTERN = /直近の決算発表日は(\d{4})年(\d{1,2})月(\d{1,2})日でした。/;

/** Parses the "直近の決算発表日" (most recent earnings announcement date) as YYYY-MM-DD, or undefined if the page has no 決算発表スケジュール section for this stock. */
export function parseLatestEarningsDate(html: string): string | undefined {
  const match = html.match(EARNINGS_DATE_PATTERN);
  if (!match) {
    return undefined;
  }
  const [, year, month, day] = match;
  return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`;
}
