/**
 * Outbound send guard — the single choke point for all PROACTIVE iMessages.
 *
 * Why this exists: every automated sender (morning brief, task nudger,
 * proactive cron, autonomous-batch) used to call sendIMessage() directly and
 * track "already sent" state in in-memory variables. The KeepAlive LaunchAgent
 * restarts the agent on crash, and every restart wiped those guards and
 * re-armed the senders — which is how Isaiah received 100+ texts in a crash
 * loop (June 2026).
 *
 * This module replaces in-memory guards with Redis-backed ones (survive
 * restarts) and adds a HARD global daily cap plus a kill-switch. Even if a new
 * code path forgets every other guard, the cap makes a message storm
 * impossible. Redis is already wired via integrations/redis-client.
 *
 * Fail-safe: if Redis is unavailable we SUPPRESS proactive sends rather than
 * fall back to un-capped sending. A missed brief is acceptable; a 100-message
 * storm is not.
 */

import { getRedis } from '../integrations/redis-client';
import { sendIMessage } from '@justice/messaging';

const DEFAULT_DAILY_MAX = 20;
const TZ = 'America/Chicago';

/** YYYY-MM-DD in Central time (en-CA renders ISO-style). */
function todayCT(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

/** Seconds remaining until the next midnight in Central time (>= 60). */
function secondsUntilMidnightCT(): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value ?? '0', 10);
  let h = get('hour');
  if (h === 24) h = 0; // some environments emit "24" for midnight
  const elapsed = h * 3600 + get('minute') * 60 + get('second');
  return Math.max(60, 86_400 - elapsed);
}

function dailyMax(): number {
  const raw = parseInt(process.env.JUSTICE_OUTBOUND_DAILY_MAX ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_MAX;
}

/** Instant silence valve — set JUSTICE_OUTBOUND_PAUSE=true to mute all automated sends. */
export function isOutboundPaused(): boolean {
  return process.env.JUSTICE_OUTBOUND_PAUSE === 'true';
}

/**
 * First-claim-of-the-day guard. Returns true only the first time it is called
 * for `key` on a given Central day; same-day calls return false. Survives
 * restarts (Redis SET NX with TTL to midnight CT).
 */
export async function claimDaily(key: string): Promise<boolean> {
  const redis = getRedis();
  const rkey = `justice:daily:${key}:${todayCT()}`;
  const res = await redis.set(rkey, '1', 'EX', secondsUntilMidnightCT(), 'NX');
  return res === 'OK';
}

/** Current value of a per-day counter. */
export async function dailyCount(key: string): Promise<number> {
  const v = await getRedis().get(`justice:count:${key}:${todayCT()}`);
  return v ? parseInt(v, 10) : 0;
}

/** Increment a per-day counter (TTL to midnight CT). Returns the new value. */
export async function incrDaily(key: string): Promise<number> {
  const redis = getRedis();
  const rkey = `justice:count:${key}:${todayCT()}`;
  const n = await redis.incr(rkey);
  if (n === 1) await redis.expire(rkey, secondsUntilMidnightCT());
  return n;
}

/** Per-day dedupe set membership (e.g. which task IDs were already nudged today). */
export async function isInDailySet(set: string, member: string): Promise<boolean> {
  return (await getRedis().sismember(`justice:set:${set}:${todayCT()}`, member)) === 1;
}

/** Add members to a per-day dedupe set (TTL to midnight CT). */
export async function addToDailySet(set: string, members: string[]): Promise<void> {
  if (members.length === 0) return;
  const redis = getRedis();
  const rkey = `justice:set:${set}:${todayCT()}`;
  await redis.sadd(rkey, ...members);
  await redis.expire(rkey, secondsUntilMidnightCT());
}

export interface GuardedSendResult {
  sent: boolean;
  reason?: 'paused' | 'cap-exceeded' | 'redis-unavailable' | string;
}

/**
 * The choke point. ALL proactive/automated iMessages must go through here
 * instead of calling sendIMessage() directly. Reactive webhook replies (a human
 * is in the loop) may stay on sendIMessage, but routing them here is also safe.
 */
export async function sendGuardedIMessage(
  phone: string,
  message: string,
  kind = 'agent_notification',
): Promise<GuardedSendResult> {
  if (isOutboundPaused()) {
    console.warn(`[send-guard] OUTBOUND PAUSED — suppressing ${kind}`);
    return { sent: false, reason: 'paused' };
  }

  const max = dailyMax();
  let count: number;
  try {
    count = await incrDaily('outbound');
  } catch (err) {
    // Fail safe: never fall back to un-capped sending.
    console.error(`[send-guard] Redis unavailable — suppressing ${kind} to avoid a storm:`, err);
    return { sent: false, reason: 'redis-unavailable' };
  }

  if (count > max) {
    // Send exactly one terminal notice the first time we cross the cap, then go silent.
    if (count === max + 1) {
      await sendIMessage(
        phone,
        `Justice hit its daily message cap (${max}) and is holding further automated messages until tomorrow. Reply if you need something.`,
      ).catch(() => {});
    }
    console.warn(`[send-guard] Daily outbound cap ${max} exceeded (count=${count}) — suppressing ${kind}`);
    return { sent: false, reason: 'cap-exceeded' };
  }

  const result = await sendIMessage(phone, message);
  if (!result.success) {
    console.error(`[send-guard] ${kind} send failed:`, result.error);
    return { sent: false, reason: result.error };
  }
  return { sent: true };
}
