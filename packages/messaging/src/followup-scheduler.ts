import { existsSync } from 'fs';
import type { LawFirmTenant } from '@justice/shared-types';
import { sendIMessage } from './imessage-sender';
import { callerFollowUp } from './message-templates';

export interface FollowUpSchedule {
  sessionId: string;
  callerPhone: string;
  tenant: LawFirmTenant;
  scheduledAt: Date;
  type: 'initial_followup' | 'document_reminder' | 'status_update';
  status: 'pending' | 'sent' | 'cancelled';
}

const pendingFollowUps = new Map<string, FollowUpSchedule[]>();

// Caller follow-ups fire from in-memory timers and bypass the agent's
// send-guard (importing it here would create a dependency cycle — send-guard
// imports sendIMessage FROM this package). So replicate the essential caps
// locally: respect the kill-switch, and cap follow-ups per caller per day.
const PAUSE_SENTINEL = `${process.env.HOME}/Developer/justice-repo/memory/OUTBOUND_PAUSE`;
const FOLLOWUP_DAILY_MAX_PER_CALLER = 1;
const callerFollowUpCount = new Map<string, { day: string; count: number }>();

function isOutboundPaused(): boolean {
  return process.env.JUSTICE_OUTBOUND_PAUSE === 'true' || existsSync(PAUSE_SENTINEL);
}

function todayCT(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

/** True (and records the send) if this caller is under their daily follow-up cap. */
function claimCallerFollowUp(callerPhone: string): boolean {
  const day = todayCT();
  const cur = callerFollowUpCount.get(callerPhone);
  const count = cur && cur.day === day ? cur.count : 0;
  if (count >= FOLLOWUP_DAILY_MAX_PER_CALLER) return false;
  callerFollowUpCount.set(callerPhone, { day, count: count + 1 });
  return true;
}

export function scheduleFollowUp(
  sessionId: string,
  callerPhone: string,
  tenant: LawFirmTenant,
  delayMinutes: number,
  type: FollowUpSchedule['type']
): FollowUpSchedule {
  const schedule: FollowUpSchedule = {
    sessionId, callerPhone, tenant,
    scheduledAt: new Date(Date.now() + delayMinutes * 60 * 1000),
    type, status: 'pending',
  };

  const existing = pendingFollowUps.get(sessionId) ?? [];
  // De-dupe: don't schedule a second follow-up of the same type for one session
  // that is still pending/sent (prevents duplicate timers stacking up).
  const duplicate = existing.find(s => s.type === type && s.status !== 'cancelled');
  if (duplicate) return duplicate;
  existing.push(schedule);
  pendingFollowUps.set(sessionId, existing);

  setTimeout(async () => {
    if (schedule.status === 'cancelled') return;
    if (isOutboundPaused()) { schedule.status = 'cancelled'; return; }
    if (!claimCallerFollowUp(callerPhone)) {
      // Over the per-caller daily cap — drop silently rather than risk a storm.
      schedule.status = 'cancelled';
      return;
    }
    await sendIMessage(callerPhone, callerFollowUp(tenant));
    schedule.status = 'sent';
  }, delayMinutes * 60 * 1000);

  return schedule;
}

export function cancelFollowUps(sessionId: string): void {
  const schedules = pendingFollowUps.get(sessionId);
  if (schedules) schedules.forEach(s => { s.status = 'cancelled'; });
}

export function getScheduledFollowUps(sessionId: string): FollowUpSchedule[] {
  return pendingFollowUps.get(sessionId) ?? [];
}
