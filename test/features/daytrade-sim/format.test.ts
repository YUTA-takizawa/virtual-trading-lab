import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAllocationPieEmbed, buildDaytradeSimEmbed } from '../../../src/features/daytrade-sim/format.ts';
import type { DaytradeLogEntry, DaytradePosition, DaytradeState, EquityPoint } from '../../../src/features/daytrade-sim/types.ts';

function makeState(log: DaytradeLogEntry[], equityHistory: EquityPoint[] = [], positions: Record<string, DaytradePosition> = {}): DaytradeState {
  return {
    cash: 1_000_000,
    realizedPnlTotal: 0,
    taxPaidTotal: 0,
    commissionPaidTotal: 0,
    positions,
    pendingOrders: {},
    lastRunDate: '2026-08-19',
    lastRunSession: 'afternoon',
    lastMorningRunDate: '2026-08-19',
    lastAfternoonRunDate: '2026-08-19',
    log,
    equityHistory,
  };
}

const STUB_CHART_URL = 'https://quickchart.io/chart/render/test-id';

// Both embed builders call quickchart.io/chart/create over the network for
// chart images (see createQuickChartUrl in format.ts, added after a GET-URL
// approach got a real Discord post rejected with 400 for being too long).
// Stub fetch so tests are fast/offline and can inspect exactly what config
// was sent, rather than round-tripping a real HTTP call.
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

describe('buildDaytradeSimEmbed', () => {
  it("keeps every field.value within Discord's 1024-char limit even with many trades", async () => {
    stubQuickChartFetch();
    // Regression test: with 527 daytrade.json candidates, a single session can
    // produce enough trades that a naive join blows past Discord's per-field
    // limit and the webhook POST gets rejected with 400 (silently dropping the
    // whole report). See 2026-08-19 afternoon run failure.
    const manyTrades: DaytradeLogEntry[] = Array.from({ length: 60 }, (_, i) => ({
      date: '2026-08-19',
      symbol: `${1000 + i}.T`,
      action: 'buy',
      price: 1234.5,
      shares: 100,
      reason: '朝の急落（-10.7%）を確認、RSI 21・出来高1.8倍で裏付けあり（ルール1: 朝の急落は買い、打診買い）',
      trancheNumber: 1,
    }));

    const embed = await buildDaytradeSimEmbed({
      date: '2026-08-19',
      session: 'afternoon',
      state: makeState(manyTrades),
      sessionTrades: manyTrades,
      newlyQueued: [],
      currentPrices: {},
      nameFor: (s) => s,
    });

    for (const field of embed.fields ?? []) {
      expect(field.value.length).toBeLessThanOrEqual(1024);
    }
  });

  it('does not truncate when trades fit comfortably', async () => {
    stubQuickChartFetch();
    const oneTrade: DaytradeLogEntry[] = [
      {
        date: '2026-08-19',
        symbol: '7532.T',
        action: 'buy',
        price: 817.9,
        shares: 13,
        reason: '朝の急落（-10.7%）を確認、RSI 21・出来高1.8倍で裏付けあり（ルール1: 朝の急落は買い、打診買い）',
        trancheNumber: 1,
      },
    ];

    const embed = await buildDaytradeSimEmbed({
      date: '2026-08-19',
      session: 'morning',
      state: makeState(oneTrade),
      sessionTrades: oneTrade,
      newlyQueued: [],
      currentPrices: {},
      nameFor: (s) => s,
    });

    const tradesField = embed.fields?.find((f) => f.name.includes('売買'));
    expect(tradesField?.value).not.toContain('…ほか');
  });

  it('shows only the trailing rule tag, not the full percentage/RSI/volume detail', async () => {
    stubQuickChartFetch();
    const trade: DaytradeLogEntry[] = [
      {
        date: '2026-08-19',
        symbol: '7532.T',
        action: 'buy',
        price: 817.9,
        shares: 13,
        reason: '朝の急落（-10.7%）を確認、RSI 21・出来高1.8倍で裏付けあり（ルール1: 朝の急落は買い、打診買い）',
        trancheNumber: 1,
      },
    ];

    const embed = await buildDaytradeSimEmbed({
      date: '2026-08-19',
      session: 'morning',
      state: makeState(trade),
      sessionTrades: trade,
      newlyQueued: [],
      currentPrices: {},
      nameFor: (s) => s,
    });

    const tradesField = embed.fields?.find((f) => f.name.includes('売買'));
    expect(tradesField?.value).toContain('ルール1: 朝の急落は買い、打診買い');
    expect(tradesField?.value).not.toContain('RSI 21');
    expect(tradesField?.value).not.toContain('出来高1.8倍');
  });

  it('shows the limit price on a newly queued tranche1 order (2026-09-01)', async () => {
    stubQuickChartFetch();
    const embed = await buildDaytradeSimEmbed({
      date: '2026-08-19',
      session: 'morning',
      state: makeState([]),
      sessionTrades: [],
      newlyQueued: [{ symbol: '7532.T', order: { action: 'buy', trancheNumber: 1, limitPrice: 817, reason: '朝の急落を確認（ルール1: 朝の急落は買い、打診買い）', queuedDate: '2026-08-19' } }],
      currentPrices: {},
      nameFor: (s) => s,
    });

    const queuedField = embed.fields?.find((f) => f.name.includes('検知した新規シグナル'));
    expect(queuedField?.value).toContain('指値');
    expect(queuedField?.value).toContain('817');
  });

  it('leaves the title unchanged when no profileLabel is given (default profile)', async () => {
    stubQuickChartFetch();
    const embed = await buildDaytradeSimEmbed({
      date: '2026-08-19',
      session: 'morning',
      state: makeState([]),
      sessionTrades: [],
      newlyQueued: [],
      currentPrices: {},
      nameFor: (s) => s,
    });
    expect(embed.title).toBe('日本株デイトレシミュ 前場レポート');
  });

  it('appends profileLabel to the title when given (2026-09-03, --profile=cheap)', async () => {
    stubQuickChartFetch();
    const embed = await buildDaytradeSimEmbed({
      date: '2026-08-19',
      session: 'afternoon',
      state: makeState([]),
      sessionTrades: [],
      newlyQueued: [],
      currentPrices: {},
      nameFor: (s) => s,
      profileLabel: '（1単元100,000円未満）',
    });
    expect(embed.title).toBe('日本株デイトレシミュ 後場レポート （1単元100,000円未満）');
  });

  it('points to the README rule reference in the footer', async () => {
    stubQuickChartFetch();
    const embed = await buildDaytradeSimEmbed({
      date: '2026-08-19',
      session: 'afternoon',
      state: makeState([]),
      sessionTrades: [],
      newlyQueued: [],
      currentPrices: {},
      nameFor: (s) => s,
    });

    expect(embed.footer?.text).toContain('README.md');
  });

  it('omits the equity chart when there are fewer than 2 history points', async () => {
    const fetchMock = stubQuickChartFetch();
    const embed = await buildDaytradeSimEmbed({
      date: '2026-08-19',
      session: 'morning',
      state: makeState([], [{ date: '2026-08-19', session: 'morning', totalEquity: 1_000_000 }]),
      sessionTrades: [],
      newlyQueued: [],
      currentPrices: {},
      nameFor: (s) => s,
    });

    expect(embed.image).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled(); // a 1-point chart isn't even worth a QuickChart request
  });

  it('renders a QuickChart-hosted equity-curve image once there are 2+ history points', async () => {
    const fetchMock = stubQuickChartFetch();
    const equityHistory: EquityPoint[] = [
      { date: '2026-08-18', session: 'morning', totalEquity: 1_000_000 },
      { date: '2026-08-18', session: 'afternoon', totalEquity: 1_010_000 },
      { date: '2026-08-19', session: 'morning', totalEquity: 990_000 },
    ];

    const embed = await buildDaytradeSimEmbed({
      date: '2026-08-19',
      session: 'morning',
      state: makeState([], equityHistory),
      sessionTrades: [],
      newlyQueued: [],
      currentPrices: {},
      nameFor: (s) => s,
    });

    expect(embed.image?.url).toBe(STUB_CHART_URL);
    const body = lastRequestBody(fetchMock);
    expect(body.chart.type).toBe('line');
    expect(body.chart.data.datasets[0]?.data).toEqual([1_000_000, 1_010_000, 990_000]);
  });

  it('caps the chart to the most recent 30 points, dropping older ones', async () => {
    const fetchMock = stubQuickChartFetch();
    const equityHistory: EquityPoint[] = Array.from({ length: 35 }, (_, i) => ({
      date: `2026-08-${String(1 + i).padStart(2, '0')}`,
      session: 'morning' as const,
      totalEquity: 1_000_000 + i,
    }));

    await buildDaytradeSimEmbed({
      date: '2026-08-19',
      session: 'morning',
      state: makeState([], equityHistory),
      sessionTrades: [],
      newlyQueued: [],
      currentPrices: {},
      nameFor: (s) => s,
    });

    const data = lastRequestBody(fetchMock).chart.data.datasets[0]?.data ?? [];
    expect(data).not.toContain(1_000_000); // the oldest (index 0) point should have been dropped
    expect(data).toContain(1_000_034); // the newest point survives
    expect(data).toHaveLength(30);
  });

  it('omits the chart image (without throwing) when the QuickChart request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('server error', { status: 500 })),
    );
    const equityHistory: EquityPoint[] = [
      { date: '2026-08-18', session: 'morning', totalEquity: 1_000_000 },
      { date: '2026-08-19', session: 'morning', totalEquity: 990_000 },
    ];

    const embed = await buildDaytradeSimEmbed({
      date: '2026-08-19',
      session: 'morning',
      state: makeState([], equityHistory),
      sessionTrades: [],
      newlyQueued: [],
      currentPrices: {},
      nameFor: (s) => s,
    });

    expect(embed.image).toBeUndefined();
  });
});

describe('buildAllocationPieEmbed', () => {
  it('returns undefined when there are no open positions', async () => {
    expect(await buildAllocationPieEmbed(makeState([]), {}, (s) => s)).toBeUndefined();
  });

  it('renders a QuickChart-hosted pie chart sized by mark-to-market value', async () => {
    const fetchMock = stubQuickChartFetch();
    const positions: Record<string, DaytradePosition> = {
      '7532.T': { tranches: [{ trancheNumber: 1, shares: 10, entryPrice: 100, entryDate: '2026-08-19' }] },
      '8316.T': { tranches: [{ trancheNumber: 1, shares: 5, entryPrice: 200, entryDate: '2026-08-19' }] },
    };

    const embed = await buildAllocationPieEmbed(makeState([], [], positions), { '7532.T': 110, '8316.T': 200 }, (s) => s);

    expect(embed?.image?.url).toBe(STUB_CHART_URL);
    const body = lastRequestBody(fetchMock);
    expect(body.chart.type).toBe('pie');
    // 7532.T: 10 shares @ 110 (current price) = 1,100 / 8316.T: 5 shares @ 200 (current price) = 1,000
    expect(body.chart.data.datasets[0]?.data).toEqual([1100, 1000]);
    expect(embed?.title).toBe('日本株デイトレシミュ 保有内訳');
  });

  it('appends profileLabel to the title when given (2026-09-03, --profile=cheap)', async () => {
    stubQuickChartFetch();
    const positions: Record<string, DaytradePosition> = {
      '7532.T': { tranches: [{ trancheNumber: 1, shares: 10, entryPrice: 100, entryDate: '2026-08-19' }] },
    };

    const embed = await buildAllocationPieEmbed(makeState([], [], positions), { '7532.T': 110 }, (s) => s, '（1単元100,000円未満）');

    expect(embed?.title).toBe('日本株デイトレシミュ 保有内訳 （1単元100,000円未満）');
  });

  it('falls back to avgEntryPrice when a current price is unavailable', async () => {
    const fetchMock = stubQuickChartFetch();
    const positions: Record<string, DaytradePosition> = {
      '7532.T': { tranches: [{ trancheNumber: 1, shares: 10, entryPrice: 100, entryDate: '2026-08-19' }] },
    };

    await buildAllocationPieEmbed(makeState([], [], positions), {}, (s) => s);

    expect(lastRequestBody(fetchMock).chart.data.datasets[0]?.data).toEqual([1000]); // 10 shares @ entryPrice 100
  });

  it('returns undefined (without throwing) when the QuickChart request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('server error', { status: 500 })),
    );
    const positions: Record<string, DaytradePosition> = {
      '7532.T': { tranches: [{ trancheNumber: 1, shares: 10, entryPrice: 100, entryDate: '2026-08-19' }] },
    };

    expect(await buildAllocationPieEmbed(makeState([], [], positions), {}, (s) => s)).toBeUndefined();
  });
});
