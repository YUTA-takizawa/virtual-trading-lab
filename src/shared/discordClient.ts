import { logger } from '../util/logger.ts';

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color: number;
  timestamp?: string;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  image?: { url: string };
}

export class DiscordWebhookError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = 'DiscordWebhookError';
  }
}

/**
 * Generic Discord webhook sender shared by every non-listing feature module.
 * Mirrors src/notify/discord.ts's postEmbeds (rate-limit/401/404 handling)
 * but isn't tied to Listing types, so morning-digest/furusato-asset/etc. can
 * reuse it without depending on the SUUMO feature's types.
 */
export async function postDiscordEmbeds(webhookUrl: string, embeds: DiscordEmbed[]): Promise<void> {
  const response = await fetch(`${webhookUrl}?wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds }),
  });

  if (response.status === 429) {
    const body = await response.text();
    let retryAfter: unknown;
    try {
      retryAfter = JSON.parse(body).retry_after;
    } catch {
      retryAfter = 'unknown';
    }
    throw new DiscordWebhookError(`Discord webhook rate limited (retry after ${retryAfter}s)`, 429, body);
  }

  if (response.status === 401 || response.status === 404) {
    throw new DiscordWebhookError('Discord webhook rejected the request — check the webhook URL secret (it may have been deleted)', response.status, await response.text());
  }

  if (!response.ok) {
    const body = await response.text();
    throw new DiscordWebhookError(`Discord webhook failed: ${response.status} ${response.statusText}`, response.status, body);
  }
}

/**
 * Best-effort alert send — logs and swallows errors instead of throwing, for
 * call sites (fatal error handlers, partial-failure notices) that must not
 * let a Discord outage crash the run.
 */
export async function postDiscordAlert(webhookUrl: string, title: string, description: string, color = 0xed4245): Promise<void> {
  try {
    await postDiscordEmbeds(webhookUrl, [{ title, description, color, timestamp: new Date().toISOString() }]);
  } catch (error) {
    logger.error('postDiscordAlert: failed to send alert to Discord', error);
  }
}

/**
 * Discord rejects the whole webhook (400) if any embed field.value exceeds
 * 1024 chars — daytrade-sim's per-symbol trade/position lists blew past that
 * once candidate lists grew large enough (see its README), so any feature
 * joining a variable-length list of lines into one field should route
 * through this rather than a plain `.join('\n')`.
 */
export function joinWithinFieldLimit(lines: string[]): string {
  const LIMIT = 1024;
  const OMISSION_BUDGET = 20; // room reserved for "\n…ほかNNN件" once truncation starts
  let result = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const next = result ? `${result}\n${line}` : line;
    const remaining = lines.length - i - 1;
    const budget = remaining > 0 ? LIMIT - OMISSION_BUDGET : LIMIT;
    if (next.length > budget) {
      return `${result}\n…ほか${lines.length - i}件`;
    }
    result = next;
  }
  return result;
}
