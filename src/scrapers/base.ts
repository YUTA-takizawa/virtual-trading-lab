import { logger } from '../util/logger.ts';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function politeFetch(url: string, init?: RequestInit): Promise<string> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Language': 'ja,en;q=0.8',
          ...init?.headers,
        },
      });

      if (!response.ok) {
        if (response.status === 403) {
          logger.warn(`politeFetch: got 403 for ${url} — the site may be blocking automated access`);
        }
        throw new Error(`politeFetch: ${response.status} ${response.statusText} for ${url}`);
      }

      return await response.text();
    } catch (error) {
      lastError = error;
      logger.warn(`politeFetch: attempt ${attempt}/${MAX_RETRIES} failed for ${url}`, error);
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`politeFetch: failed for ${url}`);
}
