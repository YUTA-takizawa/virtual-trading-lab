import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', '..', 'data');

/**
 * Shared read/write helper for the small JSON state files each new feature
 * module owns under data/ (digest-log.json, seen-sales.json, etc.) — same
 * "ENOENT means empty/default" convention as src/storage/seenStore.ts, just
 * generalized so every feature isn't reimplementing it.
 */
export async function readJsonData<T>(fileName: string, defaultValue: T): Promise<T> {
  try {
    const raw = await readFile(path.join(DATA_DIR, fileName), 'utf-8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return structuredClone(defaultValue);
    }
    throw error;
  }
}

export async function writeJsonData<T>(fileName: string, value: T): Promise<void> {
  await writeFile(path.join(DATA_DIR, fileName), `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}
