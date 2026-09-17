import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAllocationPieEmbedCrypto, buildDaytradeSimCryptoEmbed } from '../../../src/features/daytrade-sim-crypto/format.ts';
import type { DaytradeCryptoLogEntry, DaytradeCryptoPosition, DaytradeCryptoState, EquityPointCrypto } from '../../../src/features/daytrade-sim-crypto/types.ts';

function makeState(log: DaytradeCryptoLogEntry[], equityHistory: EquityPointCrypto[] = [], positions: Record<string, DaytradeCryptoPosition> = {}): DaytradeCryptoState {
  return {
    cashJpy: 1_000_000,
    realizedPnlTotalJpy: 0,
    spreadCostTotalJpy: 0,
    positions,
    lastNotifiedAt: '2026-08-29T12:00:00.000Z',
    lastNotifiedLogCount: 0,
    log,
    equityHistory,
    dashboardEquityHistory: [],
    lastDashboardPublishedAt: '2026-08-29T12:00:00.000Z',
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

describe('buildDaytradeSimCryptoEmbed', () => {
  it("keeps every field.value within Discord's 1024-char limit even with many trades", async () => {
    stubQuickChartFetch();
    const manyTrades: DaytradeCryptoLogEntry[] = Array.from({ length: 60 }, (_, i) => ({
      date: '2026-08-29',
      symbol: `COIN${i}-JPY`,
      action: 'buy',
      priceJpy: 123.45,
      quantity: 10,
      reason: '前日比急落（-10.7%）を確認、RSI 21・出来高1.8倍で裏付けあり（ルール1: 急落は買い、打診買い）',
      trancheNumber: 1,
    }));

    const embed = await buildDaytradeSimCryptoEmbed({
      date: '2026-08-29',
      session: 'night',
      state: makeState(manyTrades),
      newTrades: manyTrades,
      currentPricesJpy: {},
      nameFor: (s) => s,
    });

    for (const field of embed.fields ?? []) {
      expect(field.value.length).toBeLessThanOrEqual(1024);
    }
  });

  it('shows only the trailing rule tag, not the full percentage/RSI/volume detail', async () => {
    stubQuickChartFetch();
    const trade: DaytradeCryptoLogEntry[] = [
      {
        date: '2026-08-29',
        symbol: 'BTC-JPY',
        action: 'buy',
        priceJpy: 1_005_000,
        quantity: 0.1,
        reason: '前日比急落（-10.7%）を確認、RSI 21・出来高1.8倍で裏付けあり（ルール1: 急落は買い、打診買い）',
        trancheNumber: 1,
      },
    ];

    const embed = await buildDaytradeSimCryptoEmbed({
      date: '2026-08-29',
      session: 'morning',
      state: makeState(trade),
      newTrades: trade,
      currentPricesJpy: {},
      nameFor: (s) => s,
    });

    const tradesField = embed.fields?.find((f) => f.name.includes('売買'));
    expect(tradesField?.value).toContain('ルール1: 急落は買い、打診買い');
    expect(tradesField?.value).not.toContain('RSI 21');
    expect(tradesField?.value).not.toContain('出来高1.8倍');
  });

  it('mentions that tax is not modeled (pre-tax only) in the footer', async () => {
    stubQuickChartFetch();
    const embed = await buildDaytradeSimCryptoEmbed({
      date: '2026-08-29',
      session: 'night',
      state: makeState([]),
      newTrades: [],
      currentPricesJpy: {},
      nameFor: (s) => s,
    });

    expect(embed.footer?.text).toContain('税');
  });

  it('omits the equity chart when there are fewer than 2 history points', async () => {
    const fetchMock = stubQuickChartFetch();
    const embed = await buildDaytradeSimCryptoEmbed({
      date: '2026-08-29',
      session: 'morning',
      state: makeState([], [{ date: '2026-08-29', session: 'morning', totalEquityJpy: 1_000_000 }]),
      newTrades: [],
      currentPricesJpy: {},
      nameFor: (s) => s,
    });

    expect(embed.image).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders a QuickChart-hosted equity-curve image once there are 2+ history points', async () => {
    const fetchMock = stubQuickChartFetch();
    const equityHistory: EquityPointCrypto[] = [
      { date: '2026-08-28', session: 'morning', totalEquityJpy: 1_000_000 },
      { date: '2026-08-28', session: 'night', totalEquityJpy: 1_010_000 },
      { date: '2026-08-29', session: 'morning', totalEquityJpy: 990_000 },
    ];

    const embed = await buildDaytradeSimCryptoEmbed({
      date: '2026-08-29',
      session: 'morning',
      state: makeState([], equityHistory),
      newTrades: [],
      currentPricesJpy: {},
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
    const equityHistory: EquityPointCrypto[] = [
      { date: '2026-08-28', session: 'morning', totalEquityJpy: 1_000_000 },
      { date: '2026-08-29', session: 'morning', totalEquityJpy: 990_000 },
    ];

    const embed = await buildDaytradeSimCryptoEmbed({
      date: '2026-08-29',
      session: 'morning',
      state: makeState([], equityHistory),
      newTrades: [],
      currentPricesJpy: {},
      nameFor: (s) => s,
    });

    expect(embed.image).toBeUndefined();
  });

  it('leaves the title unchanged when no profileLabel is given (default profile)', async () => {
    stubQuickChartFetch();
    const embed = await buildDaytradeSimCryptoEmbed({
      date: '2026-08-29',
      session: 'morning',
      state: makeState([]),
      newTrades: [],
      currentPricesJpy: {},
      nameFor: (s) => s,
    });
    expect(embed.title).toBe('暗号資産デイトレシミュ 朝レポート');
  });

  it('appends profileLabel to the title when given (2026-09-04, --profile=highbudget)', async () => {
    stubQuickChartFetch();
    const embed = await buildDaytradeSimCryptoEmbed({
      date: '2026-08-29',
      session: 'night',
      state: makeState([]),
      newTrades: [],
      currentPricesJpy: {},
      nameFor: (s) => s,
      profileLabel: '（元本3,000,000円）',
    });
    expect(embed.title).toBe('暗号資産デイトレシミュ 夜レポート （元本3,000,000円）');
  });
});

describe('buildAllocationPieEmbedCrypto', () => {
  it('returns undefined when there are no open positions', async () => {
    expect(await buildAllocationPieEmbedCrypto(makeState([]), {}, (s) => s)).toBeUndefined();
  });

  it('renders a QuickChart-hosted pie chart sized by mark-to-market value', async () => {
    const fetchMock = stubQuickChartFetch();
    const positions: Record<string, DaytradeCryptoPosition> = {
      'BTC-JPY': { tranches: [{ trancheNumber: 1, quantity: 0.1, entryPriceJpy: 1_000_000, entryDate: '2026-08-29' }] },
      'ETH-JPY': { tranches: [{ trancheNumber: 1, quantity: 1, entryPriceJpy: 400_000, entryDate: '2026-08-29' }] },
    };

    const embed = await buildAllocationPieEmbedCrypto(makeState([], [], positions), { 'BTC-JPY': 1_100_000, 'ETH-JPY': 420_000 }, (s) => s);

    expect(embed?.image?.url).toBe(STUB_CHART_URL);
    const body = lastRequestBody(fetchMock);
    expect(body.chart.type).toBe('pie');
    expect(body.chart.data.datasets[0]?.data).toEqual([Math.round(0.1 * 1_100_000), Math.round(1 * 420_000)]);
  });

  it('returns undefined (without throwing) when the QuickChart request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('server error', { status: 500 })),
    );
    const positions: Record<string, DaytradeCryptoPosition> = {
      'BTC-JPY': { tranches: [{ trancheNumber: 1, quantity: 0.1, entryPriceJpy: 1_000_000, entryDate: '2026-08-29' }] },
    };

    expect(await buildAllocationPieEmbedCrypto(makeState([], [], positions), {}, (s) => s)).toBeUndefined();
  });

  it('appends profileLabel to the title when given (2026-09-04, --profile=highbudget)', async () => {
    stubQuickChartFetch();
    const positions: Record<string, DaytradeCryptoPosition> = {
      'BTC-JPY': { tranches: [{ trancheNumber: 1, quantity: 0.1, entryPriceJpy: 1_000_000, entryDate: '2026-08-29' }] },
    };

    const embed = await buildAllocationPieEmbedCrypto(makeState([], [], positions), { 'BTC-JPY': 1_100_000 }, (s) => s, '（元本3,000,000円）');

    expect(embed?.title).toBe('暗号資産デイトレシミュ 保有内訳 （元本3,000,000円）');
  });
});
