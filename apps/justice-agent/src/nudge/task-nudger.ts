/**
 * Task Nudger — Proactive iMessage reminders for upcoming/overdue tasks.
 *
 * Runs on a 30-minute interval. Sends at most 2 nudges per day during
 * waking hours (8am–10pm). Supports pause, resume, and snooze controls.
 */

import { getTasksNeedingNudge, logAuditEntry } from '../db/queries';
import { dailyCount, incrDaily, isInDailySet, addToDailySet, sendGuardedIMessage } from './send-guard';

// --- State ---
// Authoritative guards (daily nudge count + which tasks were nudged) live in
// Redis so they survive restarts / crash loops. The in-memory values below are
// display mirrors for getNudgeState() and reset on restart (cosmetic only).

let nudgedToday: Map<string, string> = new Map(); // taskId → YYYY-MM-DD (mirror)
let nudgeCountToday = 0;
let currentDay = todayStr();
let paused = false;
let snoozedUntil: Date | null = null;
let lastNudgeAt: string | null = null;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function resetIfNewDay() {
  const today = todayStr();
  if (today !== currentDay) {
    nudgedToday = new Map();
    nudgeCountToday = 0;
    currentDay = today;
  }
}

function isQuietHours(): boolean {
  const hour = new Date().getHours();
  return hour >= 22 || hour < 8;
}

// --- Public API ---

export function getNudgeState() {
  return {
    lastNudgeAt,
    nudgedTaskIds: Array.from(nudgedToday.keys()),
    nudgeCountToday,
    paused,
    snoozedUntil: snoozedUntil?.toISOString() ?? null,
  };
}

export function configureNudge(action: string, snoozeHours?: number): string {
  switch (action) {
    case 'pause':
      paused = true;
      return 'Task nudges paused. Say "resume nudges" to re-enable.';
    case 'resume':
      paused = false;
      snoozedUntil = null;
      return 'Task nudges resumed.';
    case 'snooze': {
      const hours = snoozeHours ?? 2;
      snoozedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
      return `Task nudges snoozed until ${snoozedUntil.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.`;
    }
    case 'status':
      return JSON.stringify(getNudgeState(), null, 2);
    default:
      return `Unknown nudge action: ${action}. Use pause, resume, snooze, or status.`;
  }
}

// --- Core loop ---

export async function runTaskNudge(): Promise<void> {
  resetIfNewDay();

  // Guards
  if (paused) return;
  if (snoozedUntil && new Date() < snoozedUntil) return;
  if (snoozedUntil && new Date() >= snoozedUntil) snoozedUntil = null;
  if (isQuietHours()) return;

  // Authoritative 2/day cap from Redis (survives restarts).
  try {
    if (await dailyCount('nudge') >= 2) return;
  } catch (err) {
    console.error('[nudge] Redis count read failed, skipping to avoid storm:', err);
    return;
  }

  const phoneNumber = process.env.APPROVED_NUMBER_ISAIAH;
  if (!phoneNumber) {
    console.warn('[nudge] APPROVED_NUMBER_ISAIAH not set, skipping');
    return;
  }

  let allTasks: Awaited<ReturnType<typeof getTasksNeedingNudge>>;
  try {
    allTasks = await getTasksNeedingNudge();
  } catch (err) {
    console.error('[nudge] Failed to query tasks:', err);
    return;
  }

  if (allTasks.length === 0) return;

  // Filter out already-nudged tasks today (authoritative dedupe in Redis).
  const today = todayStr();
  const newTasks: typeof allTasks = [];
  try {
    for (const t of allTasks) {
      if (!(await isInDailySet('nudged', t.id))) newTasks.push(t);
    }
  } catch (err) {
    console.error('[nudge] Redis dedupe read failed, skipping to avoid storm:', err);
    return;
  }
  if (newTasks.length === 0) return;

  // Categorize
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const endOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);

  const overdue: typeof newTasks = [];
  const dueToday: typeof newTasks = [];
  const dueTomorrow: typeof newTasks = [];
  const dueThisWeek: typeof newTasks = [];

  for (const task of newTasks) {
    const dl = task.deadline!;
    if (dl < now) overdue.push(task);
    else if (dl < endOfToday) dueToday.push(task);
    else if (dl < endOfTomorrow) dueTomorrow.push(task);
    else dueThisWeek.push(task);
  }

  // Build message
  const lines: string[] = [];

  if (overdue.length > 0) {
    lines.push(`🔴 Overdue (${overdue.length}):`);
    for (const t of overdue) {
      lines.push(`  • ${t.title} [${t.priority}] — was due ${t.deadline!.toLocaleDateString()}`);
    }
  }
  if (dueToday.length > 0) {
    lines.push(`🟡 Due today (${dueToday.length}):`);
    for (const t of dueToday) lines.push(`  • ${t.title} [${t.priority}]`);
  }
  if (dueTomorrow.length > 0) {
    lines.push(`📅 Due tomorrow (${dueTomorrow.length}):`);
    for (const t of dueTomorrow) lines.push(`  • ${t.title} [${t.priority}]`);
  }
  if (dueThisWeek.length > 0) {
    lines.push(`📋 Due this week (${dueThisWeek.length}):`);
    for (const t of dueThisWeek) {
      lines.push(`  • ${t.title} — ${t.deadline!.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`);
    }
  }

  if (lines.length === 0) return;

  const message = lines.join('\n');

  // topicMax: 2 preserves this sender's existing 2/day allowance (its own
  // dailyCount('nudge') >= 2 guard remains the primary cap; this is a backstop).
  const result = await sendGuardedIMessage(phoneNumber, message, 'task_nudge', { topicMax: 2 });
  if (result.sent) {
    lastNudgeAt = new Date().toISOString();
    // Persist authoritative guards, then update display mirrors.
    await incrDaily('nudge').catch(err => console.error('[nudge] count persist failed:', err));
    await addToDailySet('nudged', newTasks.map(t => t.id)).catch(err => console.error('[nudge] dedupe persist failed:', err));
    nudgeCountToday++;
    for (const t of newTasks) nudgedToday.set(t.id, today);
    console.log(`[nudge] Sent nudge #${nudgeCountToday} — ${newTasks.length} tasks`);

    logAuditEntry({
      caller: 'system',
      intentType: 'task_nudge',
      action: 'imessage_sent',
      result: 'success',
      details: `${newTasks.length} tasks, nudge #${nudgeCountToday}`,
    }).catch(err => console.error('[nudge] Audit log failed:', err));
  } else {
    console.error(`[nudge] Not sent (${result.reason})`);
  }
}
