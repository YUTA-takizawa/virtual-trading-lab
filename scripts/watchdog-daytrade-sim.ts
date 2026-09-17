import 'dotenv/config';
import { execSync } from 'node:child_process';
import { requireEnv } from '../src/shared/env.ts';
import { postDiscordAlert } from '../src/shared/discordClient.ts';
import { todayJstDateString } from '../src/shared/jstDate.ts';
import type { DaytradeSession, DaytradeState } from '../src/features/daytrade-sim/types.ts';

/**
 * Runs independently of GitHub Actions (intended for Windows Task Scheduler
 * on a machine that already has this repo checked out) so a GitHub-side
 * outage that silences the scheduled workflow doesn't also silence the
 * watchdog. Checks the *committed* state on origin/master (not the local
 * working tree, which could be stale) for whether today's expected session
 * actually completed; if not, sends a Discord alert so a human notices
 * faster than "happened to check the channel". Doesn't retry/re-trigger the
 * run itself — see 2026-08-27 conversation: an unattended auto-retry risks
 * masking a real problem, whereas a human deciding to `gh workflow run` is a
 * deliberate, visible action.
 */
function parseSession(argv: string[]): DaytradeSession {
  const flag = argv.find((arg) => arg.startsWith('--session='));
  const value = flag?.slice('--session='.length);
  if (value !== 'morning' && value !== 'afternoon') {
    throw new Error(`watchdog: missing/invalid --session flag (expected --session=morning or --session=afternoon, got ${value ?? 'nothing'})`);
  }
  return value;
}

async function main(): Promise<void> {
  const session = parseSession(process.argv);
  const today = todayJstDateString();

  const jstWeekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', weekday: 'short' }).format(new Date());
  if (jstWeekday === 'Sat' || jstWeekday === 'Sun') {
    console.log(`watchdog: ${jstWeekday} — market closed, skipping check`);
    return;
  }

  execSync('git fetch origin master', { stdio: 'ignore' });
  const raw = execSync('git show origin/master:data/daytrade-sim-state.json', { encoding: 'utf-8' });
  const state = JSON.parse(raw) as DaytradeState;

  // lastRunSession alone records only the most recently completed session, not
  // "did *this* session run today" — see types.ts's lastMorningRunDate/
  // lastAfternoonRunDate comment for why that distinction matters.
  const sessionRanToday = session === 'morning' ? state.lastMorningRunDate === today : state.lastAfternoonRunDate === today;
  if (sessionRanToday) {
    console.log(`watchdog: ${today} ${session} run confirmed (last${session === 'morning' ? 'Morning' : 'Afternoon'}RunDate match)`);
    return;
  }

  console.warn(`watchdog: ${today} ${session} run NOT found (state shows lastMorningRunDate=${state.lastMorningRunDate}, lastAfternoonRunDate=${state.lastAfternoonRunDate})`);
  const webhookUrl = requireEnv('DISCORD_WEBHOOK_DAYTRADE');
  await postDiscordAlert(
    webhookUrl,
    'Daytrade Sim Watchdog: 実行未確認',
    `本日（${today}）の${session === 'morning' ? '午前' : '午後'}実行が確認できませんでした。GitHub Actionsの状態を確認し、必要なら手動実行してください:\n\`gh workflow run daytrade-sim.yml -f session=${session}\``,
  );
}

main().catch((error) => {
  console.error('watchdog: fatal error', error);
  process.exitCode = 1;
});
