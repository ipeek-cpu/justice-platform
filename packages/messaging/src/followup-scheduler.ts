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
  existing.push(schedule);
  pendingFollowUps.set(sessionId, existing);

  setTimeout(async () => {
    if (schedule.status === 'cancelled') return;
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
