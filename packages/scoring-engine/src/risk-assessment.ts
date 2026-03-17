import type { ScoredStatute, TriageContext } from '@justice/shared-types';
import type { RiskFlag } from '@justice/shared-types';

export function assessRisks(
  context: TriageContext,
  statutes: ScoredStatute[]
): RiskFlag[] {
  const flags: RiskFlag[] = [];

  const nearExpiry = statutes.filter(s => {
    const remaining = s.solDays - context.timelineDaysAgo;
    return remaining > 0 && remaining < 90;
  });
  if (nearExpiry.length > 0) {
    flags.push({
      text: `Statute of limitations approaching for: ${nearExpiry.map(s => s.name).join(', ')}. Prompt action recommended.`,
      severity: 'high',
      mitigationNote: 'Prioritize filing or preserving claims within the next 90 days.',
    });
  }

  const expired = statutes.filter(s => context.timelineDaysAgo > s.solDays);
  if (expired.length > 0) {
    flags.push({
      text: `Statute of limitations may have expired for: ${expired.map(s => s.name).join(', ')}.`,
      severity: 'high',
      mitigationNote: 'Attorney should evaluate tolling arguments or continuing violation doctrine.',
    });
  }

  if (!context.documentationPresent) {
    flags.push({
      text: 'No documentation currently available — may increase discovery costs.',
      severity: 'medium',
      mitigationNote: 'Advise caller to preserve any existing records, emails, or communications.',
    });
  }

  if (context.employerSize < 15 && statutes.some(s => s.category === 'discrimination')) {
    flags.push({
      text: 'Employer has fewer than 15 employees — federal discrimination statutes may not apply.',
      severity: 'medium',
      mitigationNote: 'Illinois Human Rights Act covers employers with 1+ employees.',
    });
  }

  if (context.workerType === 'contractor') {
    flags.push({
      text: 'Caller classified as independent contractor — some employment protections may not apply.',
      severity: 'medium',
      mitigationNote: 'Evaluate whether misclassification argument is viable.',
    });
  }

  if (context.w2RangeStr === 'under_30k' || context.w2RangeStr === 'unknown') {
    flags.push({
      text: 'Lower income range may affect damages calculation and contingency viability.',
      severity: 'low',
      mitigationNote: 'Fee-shifting statutes can offset lower expected damages.',
    });
  }

  return flags;
}
