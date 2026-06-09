import { sendIMessage } from '@justice/messaging';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { executionLogger } from '../integrations/execution-logger';
import { isAutonomousBatchEnabled } from '../config/feature-flags';

const execAsync = promisify(exec);
const ISAIAH = process.env.APPROVED_NUMBER_ISAIAH!;

// Run all proactive checks. Called by cron at 8am daily.
export async function runProactiveChecks(): Promise<void> {
  const alerts: string[] = [];

  // Check 1: Stale case metrics (no report in 7 days)
  const lastMetrics = await getLastMetricsDate();
  if (lastMetrics && daysSince(lastMetrics) >= 7) {
    alerts.push(`Case metrics haven't run since ${lastMetrics}. Run now?`);
  }

  // Check 2: Aging blocked beads (blocked > 48 hours)
  const { stdout: blockedOutput } = await execAsync(
    `${process.env.HOME}/.local/bin/bd list --status blocked --json`
  ).catch(() => ({ stdout: '[]' }));
  const blocked = JSON.parse(blockedOutput || '[]');
  const agingBlocked = blocked.filter((b: any) =>
    b.updated_at && daysSince(b.updated_at) >= 2
  );
  if (agingBlocked.length > 0) {
    alerts.push(
      `${agingBlocked.length} bead(s) blocked 2+ days: ` +
      agingBlocked.map((b: any) => b.id).join(', ')
    );
  }

  // Check 3: iOS project idle (in_progress > 72 hours with no commits)
  const { stdout: inProgressOutput } = await execAsync(
    `${process.env.HOME}/.local/bin/bd list --status in_progress --label ios --json`
  ).catch(() => ({ stdout: '[]' }));
  const inProgress = JSON.parse(inProgressOutput || '[]');
  const idle = inProgress.filter((b: any) =>
    b.updated_at && daysSince(b.updated_at) >= 3
  );
  if (idle.length > 0) {
    alerts.push(
      `iOS task(s) idle 3+ days with no activity: ` +
      idle.map((b: any) => `${b.id} (${b.title})`).join(', ')
    );
  }

  // Check 4: LinkedIn recruiter pipeline (no outreach in 14 days)
  const lastOutreach = await getLastLinkedInOutreachDate();
  if (lastOutreach && daysSince(lastOutreach) >= 14) {
    alerts.push(`No recruiter outreach in ${daysSince(lastOutreach)} days. Want me to draft a new batch?`);
  }

  // Check 5: Stuck task detection (no log event for 30+ min)
  // DEPRECATED (2026-06-09): part of the autonomous-batch pipeline, off by
  // default. Gated so stale execution-log entries no longer fire daily pings.
  if (isAutonomousBatchEnabled()) {
    const activeTasks = executionLogger.getActiveTasks();
    for (const task of activeTasks) {
      const lastEvent = executionLogger.getLastEventForBead(task.beadId!);
      if (!lastEvent?.ts) continue;
      const minutesSinceLastEvent = Math.round(
        (Date.now() - new Date(lastEvent.ts).getTime()) / 60000
      );
      if (minutesSinceLastEvent >= 30) {
        alerts.push(
          `Task ${task.beadId} (${task.project}) may be stuck — ` +
          `last event ${minutesSinceLastEvent} min ago (${lastEvent.event}). ` +
          `Reply "unstick ${task.beadId}" to kill and reopen.`
        );
      }
    }
  }

  // Send consolidated alert if any conditions met
  if (alerts.length > 0) {
    const msg = `Good morning. ${alerts.length} item(s) need attention:\n` +
      alerts.map((a, i) => `${i + 1}. ${a}`).join('\n');
    await sendIMessage(ISAIAH, msg);
  }
}

function daysSince(dateStr: string): number {
  return Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
  );
}

// These read from a local state file
// State file at ~/Developer/justice-repo/memory/state.json
async function getLastMetricsDate(): Promise<string | null> {
  try {
    const state = readState();
    return state.lastMetricsDate ?? null;
  } catch { return null; }
}

async function getLastLinkedInOutreachDate(): Promise<string | null> {
  try {
    const state = readState();
    return state.lastLinkedInOutreachDate ?? null;
  } catch { return null; }
}

export function readState(): Record<string, string> {
  const file = path.join(process.env.HOME!, 'Developer/justice-repo/memory/state.json');
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function updateState(key: string, value: string): void {
  const dir = path.join(process.env.HOME!, 'Developer/justice-repo/memory');
  const file = path.join(dir, 'state.json');
  fs.mkdirSync(dir, { recursive: true });
  const state = readState();
  state[key] = value;
  fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
}
