import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAllocationPieEmbedUs, buildDaytradeSimUsEmbed } from '../../../src/features/daytrade-sim-us/format.ts';
import type { DaytradeUsLogEntry, DaytradeUsPosition, DaytradeUsState, EquityPointUs } from '../../../src/features/daytrade-sim-us/types.ts';

function makeState(log: DaytradeUsLogEntry[], equityHistory: EquityPointUs[] = [], positions: Record<string, DaytradeUsPosition> = {}): DaytradeUsState {
  return {
    cashJpy: 1_000_000,
    realizedPnlTotalJpy: 0,
    taxPaidTotalJpy: 0,
    secFeeTotalUsd: 0,
    finraFeeTotalUsd: 0,
    positions,
    pendingOrders: {},
    lastRunDate: '2026-08-19',
    log,
    equityHistory,
  };
}

const STUB_CHART_URL = 'https://quickchart.io/chart/render/test-id';

function stubQuickChartFetch() {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ success: true, url: STUB_CHART_URL }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function lastRequestBody(fetchMock: ReturnType<typeof stubQuickChartFetch>): { chart: { type: string; data: { labels: string[]; datasets: { data: number[] }[] } } } {
  const call = fetchMock.mock.calls.at(-1)!;
  return JSON.parse(call[1]!.body as string);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildDaytradeSimUsEmbed', () => {
  it("keeps every field.value within Discord's 1024-char limit even with many trades", async () => {
    stubQuickChartFetch();
    const manyTrades: DaytradeUsLogEntry[] = Array.from({ length: 60 }, (_, i) => ({
      date: '2026-08-19',
      symbol: `SYM${i}`,
      action: 'buy',
      priceUsd: 123.45,
      fxRate: 150.15,
      shares: 10,
      reason: '前日比急落（-10.7%）を確認、RSI 21・出来高1.8倍で裏付けあり（ルール1: 急落は買い、打診買い）',
      trancheNumber: 1,
    }));

    const embed = await buildDaytradeSimUsEmbed({
      date: '2026-08-19',
      state: makeState(manyTrades),
      todaysTrades: manyTrades,
      newlyQueued: [],
      currentPricesUsd: {},
      currentFxRate: 150,
      nameFor: (s) => s,
    });

    for (const field of embed.fields ?? []) {
      expect(field.value.length).toBeLessThanOrEqual(1024);
    }
  });

  it('shows only the trailing rule tag, not the full percentage/RSI/volume detail', async () => {
    stubQuickChartFetch();
    const trade: DaytradeUsLogEntry[] = [
      {
        date: '2026-08-19',
        symbol: 'AAPL',
        action: 'buy',
        priceUsd: 220.5,
        fxRate: 150.15,
        shares: 13,
        reason: '前日比急落（-10.7%）を確認、RSI 21・出来高1.8倍で裏付けあり（ルール1: 急落は買い、打診買い）',
        trancheNumber: 1,
      },
    ];

    const embed = await buildDaytradeSimUsEmbed({
      date: '2026-08-19',
      state: makeState(trade),
      todaysTrades: trade,
      newlyQueued: [],
      currentPricesUsd: {},
      currentFxRate: 150,
      nameFor: (s) => s,
    });

    const tradesField = embed.fields?.find((f) => f.name.includes('売買'));
    expect(tradesField?.value).toContain('ルール1: 急落は買い、打診買い');
    expect(tradesField?.value).not.toContain('RSI 21');
    expect(tradesField?.value).not.toContain('出来高1.8倍');
  });

  it('formats fractional shares (Webull dollar-denominated orders) down to 0.00001, trimming trailing zeros', async () => {
    stubQuickChartFetch();
    const trade: DaytradeUsLogEntry[] = [
      { date: '2026-08-19', symbol: 'AAPL', action: 'buy', priceUsd: 220.5, fxRate: 150.15, shares: 12.34567, reason: 'test（ルール1: dummy）', trancheNumber: 1 },
      { date: '2026-08-19', symbol: 'MSFT', action: 'buy', priceUsd: 400, fxRate: 150.15, shares: 66, reason: 'test（ルール1: dummy）', trancheNumber: 1 },
    ];

    const embed = await buildDaytradeSimUsEmbed({
      date: '2026-08-19',
      state: makeState(trade),
      todaysTrades: trade,
      newlyQueued: [],
      currentPricesUsd: {},
      currentFxRate: 150,
      nameFor: (s) => s,
    });

    const tradesField = embed.fields?.find((f) => f.name.includes('売買'));
    expect(tradesField?.value).toContain('12.34567株');
    expect(tradesField?.value).toContain('66株'); // whole-share fill shouldn't show trailing ".00000"
  });

  it('mentions the omitted PER/PBR filter and earnings-day play in the footer', async () => {
    stubQuickChartFetch();
    const embed = await buildDaytradeSimUsEmbed({
      date: '2026-08-19',
      state: makeState([]),
      todaysTrades: [],
      newlyQueued: [],
      currentPricesUsd: {},
      currentFxRate: 150,
      nameFor: (s) => s,
    });

    expect(embed.footer?.text).toContain('PER/PBR');
  });

  it('omits the equity chart when there are fewer than 2 history points', async () => {
    const fetchMock = stubQuickChartFetch();
    const embed = await buildDaytradeSimUsEmbed({
      date: '2026-08-19',
      state: makeState([], [{ date: '2026-08-19', totalEquityJpy: 1_000_000 }]),
      todaysTrades: [],
      newlyQueued: [],
      currentPricesUsd: {},
      currentFxRate: 150,
      nameFor: (s) => s,
    });

    expect(embed.image).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders a QuickChart-hosted equity-curve image once there are 2+ history points', async () => {
    const fetchMock = stubQuickChartFetch();
    const equityHistory: EquityPointUs[] = [
      { date: '2026-08-17', totalEquityJpy: 1_000_000 },
      { date: '2026-08-18', totalEquityJpy: 1_010_000 },
      { date: '2026-08-19', totalEquityJpy: 990_000 },
    ];

    const embed = await buildDaytradeSimUsEmbed({
      date: '2026-08-19',
      state: makeState([], equityHistory),
      todaysTrades: [],
      newlyQueued: [],
      currentPricesUsd: {},
      currentFxRate: 150,
      nameFor: (s) => s,
    });

    expect(embed.image?.url).toBe(STUB_CHART_URL);
    const body = lastRequestBody(fetchMock);
    expect(body.chart.type).toBe('line');
    expect(body.chart.data.datasets[0]?.data).toEqual([1_000_000, 1_010_000, 990_000]);
  });

  it('omits the chart image (without throwing) when the QuickChart request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('server error', { status: 500 })),
    );
    const equityHistory: EquityPointUs[] = [
      { date: '2026-08-18', totalEquityJpy: 1_000_000 },
      { date: '2026-08-19', totalEquityJpy: 990_000 },
    ];

    const embed = await buildDaytradeSimUsEmbed({
      date: '2026-08-19',
      state: makeState([], equityHistory),
      todaysTrades: [],
      newlyQueued: [],
      currentPricesUsd: {},
      currentFxRate: 150,
      nameFor: (s) => s,
    });

    expect(embed.image).toBeUndefined();
  });

  it('leaves the title unchanged when no profileLabel is given (default profile)', async () => {
    stubQuickChartFetch();
    const embed = await buildDaytradeSimUsEmbed({
      date: '2026-08-19',
      state: makeState([]),
      todaysTrades: [],
      newlyQueued: [],
      currentPricesUsd: {},
      currentFxRate: 150,
      nameFor: (s) => s,
    });
    expect(embed.title).toBe('米国株デイトレシミュ 日次レポート');
  });

  it('appends profileLabel to the title when given (2026-09-04, --profile=highbudget)', async () => {
    stubQuickChartFetch();
    const embed = await buildDaytradeSimUsEmbed({
      date: '2026-08-19',
      state: makeState([]),
      todaysTrades: [],
      newlyQueued: [],
      currentPricesUsd: {},
      currentFxRate: 150,
      nameFor: (s) => s,
      profileLabel: '（元本3,000,000円）',
    });
    expect(embed.title).toBe('米国株デイトレシミュ 日次レポート （元本3,000,000円）');
  });
});

describe('buildAllocationPieEmbedUs', () => {
  it('returns undefined when there are no open positions', async () => {
    expect(await buildAllocationPieEmbedUs(makeState([]), {}, 150, (s) => s)).toBeUndefined();
  });

  it('renders a QuickChart-hosted pie chart sized by mark-to-market value in yen', async () => {
    const fetchMock = stubQuickChartFetch();
    const positions: Record<string, DaytradeUsPosition> = {
      AAPL: { tranches: [{ trancheNumber: 1, shares: 10, entryPriceUsd: 100, entryFxRate: 150, entryDate: '2026-08-19' }] },
      MSFT: { tranches: [{ trancheNumber: 1, shares: 5, entryPriceUsd: 200, entryFxRate: 150, entryDate: '2026-08-19' }] },
    };

    const embed = await buildAllocationPieEmbedUs(makeState([], [], positions), { AAPL: 110, MSFT: 200 }, 150, (s) => s);

    expect(embed?.image?.url).toBe(STUB_CHART_URL);
    const body = lastRequestBody(fetchMock);
    expect(body.chart.type).toBe('pie');
    // AAPL: 10 shares @ $110 * 150円 = 165,000 / MSFT: 5 shares @ $200 * 150円 = 150,000
    expect(body.chart.data.datasets[0]?.data).toEqual([165000, 150000]);
  });

  it('falls back to avgEntryPriceUsd when a current price is unavailable', async () => {
    const fetchMock = stubQuickChartFetch();
    const positions: Record<string, DaytradeUsPosition> = {
      AAPL: { tranches: [{ trancheNumber: 1, shares: 10, entryPriceUsd: 100, entryFxRate: 150, entryDate: '2026-08-19' }] },
    };

    await buildAllocationPieEmbedUs(makeState([], [], positions), {}, 150, (s) => s);

    expect(lastRequestBody(fetchMock).chart.data.datasets[0]?.data).toEqual([150000]); // 10 shares @ entryPriceUsd 100 * 150円
  });

  it('returns undefined (without throwing) when the QuickChart request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('server error', { status: 500 })),
    );
    const positions: Record<string, DaytradeUsPosition> = {
      AAPL: { tranches: [{ trancheNumber: 1, shares: 10, entryPriceUsd: 100, entryFxRate: 150, entryDate: '2026-08-19' }] },
    };

    expect(await buildAllocationPieEmbedUs(makeState([], [], positions), {}, 150, (s) => s)).toBeUndefined();
  });

  it('appends profileLabel to the title when given (2026-09-04, --profile=highbudget)', async () => {
    stubQuickChartFetch();
    const positions: Record<string, DaytradeUsPosition> = {
      AAPL: { tranches: [{ trancheNumber: 1, shares: 10, entryPriceUsd: 100, entryFxRate: 150, entryDate: '2026-08-19' }] },
    };

    const embed = await buildAllocationPieEmbedUs(makeState([], [], positions), { AAPL: 110 }, 150, (s) => s, '（元本3,000,000円）');

    expect(embed?.title).toBe('米国株デイトレシミュ 保有内訳 （元本3,000,000円）');
  });
});
