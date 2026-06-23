/**
 * Morning Brief — Daily iMessage briefing for Isaiah.
 *
 * Runs on a 10-minute interval. Sends once per day between
 * 8:00–8:15 AM CT. Uses Claude to generate a natural, conversational
 * message from task and case data.
 */

import { getPendingTasksByAssignee, getCaseMetrics, logAuditEntry } from '../db/queries';
import { claimDaily, sendGuardedIMessage } from './send-guard';

// --- State ---
// The authoritative "already sent today" guard lives in Redis (claimDaily),
// so it survives restarts / crash loops. lastBriefDate is an in-memory mirror
// kept only for the status-display getter.

let lastBriefDate: string | null = null;
let enabled = true;

function todayStrCT(): string {
  return new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
}

function getCTHour(): number {
  return parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }));
}

function getCTMinute(): number {
  return parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', minute: 'numeric' }));
}

// --- Public API ---

export function getMorningBriefState() {
  return { lastBriefDate, enabled };
}

export function setMorningBriefEnabled(value: boolean) {
  enabled = value;
}

// --- Brief generation via Claude ---

async function generateBriefMessage(data: {
  date: string;
  overdue: { title: string; daysOverdue: number; priority: string }[];
  dueToday: { title: string; priority: string }[];
  dueThisWeek: { title: string; deadline: string; priority: string }[];
  noDeadline: { title: string; priority: string }[];
  caseMetrics: { total: number; today: number };
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return buildFallbackMessage(data);

  const model = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6';

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        system: 'You are Justice, writing a morning briefing for Isaiah via iMessage. Be concise, warm, actionable. No bullet points unless 3+ items. Lead with the most urgent thing. If nothing is urgent, keep it to 1-2 sentences. Never exceed 500 characters. CRITICAL: Use ONLY the names, companies, deals, and facts present in the data below. Never invent or guess a person, company, case, or deal name. If the data is sparse, say so plainly rather than filling it in.',
        messages: [{
          role: 'user',
          content: `Generate a morning brief for today (${data.date}). Here's the data:\n\n${JSON.stringify(data, null, 2)}`,
        }],
      }),
    });

    if (!response.ok) {
      console.error(`[morning-brief] Claude API error: ${response.status}`);
      return buildFallbackMessage(data);
    }

    const result = await response.json() as { content: Array<{ type: string; text?: string }> };
    const text = result.content?.find(b => b.type === 'text')?.text;
    return text ?? buildFallbackMessage(data);
  } catch (err) {
    console.error('[morning-brief] Claude API request failed:', err);
    return buildFallbackMessage(data);
  }
}

function buildFallbackMessage(data: {
  overdue: { title: string }[];
  dueToday: { title: string }[];
  dueThisWeek: { title: string }[];
  noDeadline: { title: string }[];
  caseMetrics: { total: number; today: number };
}): string {
  const total = data.overdue.length + data.dueToday.length + data.dueThisWeek.length + data.noDeadline.length;
  const parts: string[] = [`Morning — ${total} pending tasks.`];
  if (data.overdue.length > 0) parts.push(`${data.overdue.length} overdue.`);
  if (data.dueToday.length > 0) parts.push(`${data.dueToday.length} due today.`);
  if (data.caseMetrics.today > 0) parts.push(`${data.caseMetrics.today} new cases.`);
  return parts.join(' ');
}

// --- Core loop ---

export async function runMorningBrief(force = false): Promise<void> {
  if (!enabled && !force) return;

  const today = todayStrCT();

  // Time window check (8:00–8:15 AM CT) unless forced
  if (!force) {
    const hour = getCTHour();
    const minute = getCTMinute();
    if (hour !== 8 || minute > 15) return;
  }

  const phoneNumber = process.env.APPROVED_NUMBER_ISAIAH;
  if (!phoneNumber) {
    console.warn('[morning-brief] APPROVED_NUMBER_ISAIAH not set, skipping');
    return;
  }

  // Claim the day BEFORE doing any work. This is the anti-storm guard: the
  // claim is consumed once per Central day (Redis, survives restarts), so a
  // crash loop or a failed send cannot cause repeated briefs. Manual force
  // bypasses the claim.
  if (!force) {
    try {
      if (!(await claimDaily('brief'))) return; // already handled today
    } catch (err) {
      console.error('[morning-brief] Redis claim failed, skipping to avoid storm:', err);
      return;
    }
  }
  lastBriefDate = today;

  // Gather data
  let pendingTasks: Awaited<ReturnType<typeof getPendingTasksByAssignee>>;
  let caseMetrics: Awaited<ReturnType<typeof getCaseMetrics>>;
  try {
    [pendingTasks, caseMetrics] = await Promise.all([
      getPendingTasksByAssignee('isaiah'),
      getCaseMetrics(),
    ]);
  } catch (err) {
    console.error('[morning-brief] Failed to query data:', err);
    return;
  }

  // Categorize tasks
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const endOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);

  const overdue: { title: string; daysOverdue: number; priority: string }[] = [];
  const dueToday: { title: string; priority: string }[] = [];
  const dueThisWeek: { title: string; deadline: string; priority: string }[] = [];
  const noDeadline: { title: string; priority: string }[] = [];

  for (const task of pendingTasks) {
    if (!task.deadline) {
      noDeadline.push({ title: task.title, priority: task.priority });
    } else if (task.deadline < startOfToday) {
      const daysOverdue = Math.ceil((startOfToday.getTime() - task.deadline.getTime()) / (1000 * 60 * 60 * 24));
      overdue.push({ title: task.title, daysOverdue, priority: task.priority });
    } else if (task.deadline < endOfToday) {
      dueToday.push({ title: task.title, priority: task.priority });
    } else if (task.deadline < endOfWeek) {
      dueThisWeek.push({
        title: task.title,
        deadline: task.deadline.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        priority: task.priority,
      });
    }
  }

  // No tasks and no new cases — skip (day already claimed above)
  if (pendingTasks.length === 0 && caseMetrics.today === 0) {
    console.log('[morning-brief] Nothing to report, skipping send');
    return;
  }

  const currentDate = now.toLocaleDateString('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const briefMessage = await generateBriefMessage({
    date: currentDate,
    overdue,
    dueToday,
    dueThisWeek,
    noDeadline,
    caseMetrics: { total: caseMetrics.total, today: caseMetrics.today },
  });

  const result = await sendGuardedIMessage(phoneNumber, briefMessage, 'morning_brief');
  if (result.sent) {
    console.log(`[morning-brief] Sent for ${today}`);

    logAuditEntry({
      caller: 'system',
      intentType: 'morning_brief',
      action: 'imessage_sent',
      result: 'success',
      details: `tasks: ${pendingTasks.length}, overdue: ${overdue.length}, cases_today: ${caseMetrics.today}`,
    }).catch(err => console.error('[morning-brief] Audit log failed:', err));
  } else {
    // Day is already claimed, so we will NOT retry today even though this send
    // did not go out — that is the intended anti-storm trade-off.
    console.error(`[morning-brief] Not sent (${result.reason})`);
  }
}
