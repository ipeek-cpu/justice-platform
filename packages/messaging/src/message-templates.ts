import type { LawFirmTenant } from '@justice/shared-types';

/**
 * All templates are law-firm-branded.
 * NEVER include Wronged.ai or Justice in caller-facing messages.
 */

export function callerIntakeLink(tenant: LawFirmTenant, sessionId: string): string {
  return [
    `${tenant.displayName} — Quick Intake Form`,
    '',
    `Thank you for speaking with us. To help our attorneys review your situation, please complete this short form:`,
    '',
    `${tenant.documentPortalUrl}/intake?session=${sessionId}`,
    '',
    `This takes about 5 minutes. Your information is kept confidential.`,
    '',
    `— ${tenant.displayName}`,
  ].join('\n');
}

export function callerFollowUp(tenant: LawFirmTenant): string {
  return [
    `${tenant.displayName} — Follow Up`,
    '',
    `Thank you for sharing your situation with us. An attorney from ${tenant.displayName} will review your information and follow up with you directly.`,
    '',
    `If you have additional documentation, upload securely here:`,
    `${tenant.documentPortalUrl}/upload`,
    '',
    `— ${tenant.displayName}`,
  ].join('\n');
}

export function attorneyNewCase(sessionId: string, topStatute: string, economicLabel: string, portalUrl: string): string {
  return [
    `New case available for review`,
    `Session: ${sessionId}`,
    `Top match: ${topStatute}`,
    `Economic viability: ${economicLabel}`,
    `View full deck: ${portalUrl}/cases/${sessionId}`,
  ].join('\n');
}

export function attorneyCaseAccepted(sessionId: string, attorneyName: string): string {
  return `Case ${sessionId} accepted by ${attorneyName}. Intake workflow initiated.`;
}
