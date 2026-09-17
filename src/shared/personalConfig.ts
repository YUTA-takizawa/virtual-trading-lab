import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(__dirname, '..', '..', 'config');

export interface PersonalConfig {
  weather: {
    jmaAreaCode: string;
    areaNameContains: string;
    tempAreaNameContains: string;
    label: string;
  };
  transit: {
    statusUrl: string;
    lineKeywords: string[];
  };
  news: {
    themes: { name: string; query: string; maxItems: number }[];
  };
  calendar: {
    calendarId: string;
    timezone: string;
  };
  sale: {
    rakutenCalendarUrl: string;
    lookaheadDays: number;
    keywords: string[];
  };
}

export async function readPersonalConfig(): Promise<PersonalConfig> {
  const raw = await readFile(path.join(CONFIG_DIR, 'personal.json'), 'utf-8');
  return JSON.parse(raw) as PersonalConfig;
}

export async function readJsonConfig<T>(fileName: string): Promise<T> {
  const raw = await readFile(path.join(CONFIG_DIR, fileName), 'utf-8');
  return JSON.parse(raw) as T;
}
