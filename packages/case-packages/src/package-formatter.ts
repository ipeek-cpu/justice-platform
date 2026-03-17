import type { CasePackage } from '@justice/shared-types';

export function formatForSMS(casePackage: CasePackage): string {
  const primary = casePackage.primaryStatutes[0];
  const label = casePackage.economicViability.label;
  const score = casePackage.economicViability.score;

  let msg = `New case: ${casePackage.sessionId}\n`;
  if (primary) msg += `Top match: ${primary.name} (${primary.score}/100)\n`;
  msg += `Econ viability: ${label} (${score}/100)\n`;
  msg += `Statutes: ${casePackage.primaryStatutes.length} primary, ${casePackage.secondaryStatutes.length} secondary\n`;
  msg += `View: ${process.env.PORTAL_BASE_URL}/cases/${casePackage.sessionId}`;

  return msg.length > 320 ? msg.substring(0, 317) + '...' : msg;
}

export function formatForJSON(casePackage: CasePackage): string {
  return JSON.stringify(casePackage, null, 2);
}

export function formatForPortalLink(casePackage: CasePackage): string {
  return `${process.env.PORTAL_BASE_URL}/cases/${casePackage.sessionId}`;
}
