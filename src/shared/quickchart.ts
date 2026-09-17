import { logger } from '../util/logger.ts';

export interface ChartSpec {
  config: object;
  width: number;
  height: number;
}

/**
 * QuickChart.io's GET /chart endpoint takes the Chart.js config as a URL
 * param, but Discord silently rejects (400) any embed whose image.url is too
 * long — a daytrade-sim pie chart blew past that with just 21 positions
 * (caught by an actual send before it went live). /chart/create instead
 * POSTs the config and returns a short, fixed-length URL. No npm dependency
 * or local canvas rendering either way. Fails open (undefined, logged)
 * rather than throwing, since a missing chart shouldn't block the rest of
 * whatever report is being built.
 */
export async function createQuickChartUrl(spec: ChartSpec): Promise<string | undefined> {
  try {
    const response = await fetch('https://quickchart.io/chart/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chart: spec.config, width: spec.width, height: spec.height, backgroundColor: 'white' }),
    });
    if (!response.ok) {
      throw new Error(`quickchart.io/chart/create returned ${response.status}`);
    }
    const body = (await response.json()) as { success?: boolean; url?: string };
    if (!body.success || typeof body.url !== 'string') {
      throw new Error(`quickchart.io/chart/create response missing url: ${JSON.stringify(body)}`);
    }
    return body.url;
  } catch (error) {
    logger.warn('quickchart: short-URL creation failed, omitting chart image', error);
    return undefined;
  }
}

/** Evenly spaced hues so an arbitrary number of pie slices stay visually distinct without a fixed palette running out. */
export function distinctColors(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `hsl(${Math.round((360 / count) * i)}, 65%, 55%)`);
}
