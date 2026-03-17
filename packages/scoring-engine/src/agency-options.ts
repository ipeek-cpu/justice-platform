import type { TriageContext, ScoredStatute, AgencyOption } from '@justice/shared-types';
import type { AgencyOptionSummary } from '@justice/shared-types';

export function getApplicableAgencies(
  context: TriageContext,
  statutes: ScoredStatute[]
): AgencyOptionSummary[] {
  const agencies: AgencyOptionSummary[] = [];
  const seen = new Set<string>();

  for (const statute of statutes) {
    if (!statute.agencyFiling) continue;
    if (seen.has(statute.agencyFiling.acronym)) continue;

    if (isAgencyApplicable(statute.agencyFiling, context, statute.score)) {
      seen.add(statute.agencyFiling.acronym);
      agencies.push({
        agencyName: statute.agencyFiling.name,
        acronym: statute.agencyFiling.acronym,
        url: statute.agencyFiling.url,
        claimType: statute.agencyFiling.claimType,
        deadline: statute.agencyFiling.timeLimitDescription,
        callerCanSelfFile: statute.agencyFiling.callerCanSelfFile,
      });
    }
  }

  return agencies;
}

function isAgencyApplicable(agency: AgencyOption, context: TriageContext, statuteScore: number): boolean {
  for (const condition of agency.applicabilityConditions) {
    switch (condition.field) {
      case 'situationTags':
        if (condition.operator === 'includes') {
          if (!context.situationTags.some(t => t.includes(condition.value as string))) return false;
        }
        break;
      case 'protectedCharacteristics':
        if (condition.operator === 'exists' && condition.value === true) {
          if (context.protectedCharacteristics.length === 0) return false;
        }
        break;
      case 'employerSize':
        if (condition.operator === 'gte') {
          if (context.employerSize < (condition.value as number)) return false;
        }
        break;
      case 'score':
        if (condition.operator === 'gte') {
          if (statuteScore < (condition.value as number)) return false;
        }
        break;
    }
  }
  return true;
}
