import type { TriageContext, ScoredStatute, EconomicViabilityScore, CaseLawResult } from '@justice/shared-types';
import type { CasePackage, ArguingPoint, RiskFlag, AgencyOptionSummary, RecommendedAction } from '@justice/shared-types';
import { generateDealSummary } from './summary-generator';

const STANDARD_DISCLAIMER = 'This assessment is educational only and does not constitute legal advice. Only a licensed attorney can determine whether a claim is viable.';

export function generateCaseDeck(params: {
  context: TriageContext;
  statutes: ScoredStatute[];
  caseLaw: CaseLawResult[];
  economicViability: EconomicViabilityScore;
  arguingPoints: ArguingPoint[];
  riskFlags: RiskFlag[];
  agencyOptions: AgencyOptionSummary[];
}): CasePackage {
  const { context, statutes, caseLaw, economicViability, arguingPoints, riskFlags, agencyOptions } = params;

  return {
    sessionId: context.sessionId,
    tenantId: context.tenantId,
    createdAt: new Date().toISOString(),
    geography: context.geography,
    dealSummary: generateDealSummary(context, statutes),
    primaryStatutes: statutes.filter(s => s.score >= 70),
    secondaryStatutes: statutes.filter(s => s.score >= 40 && s.score < 70),
    possibleStatutes: statutes.filter(s => s.score >= 20 && s.score < 40),
    caseLawReferences: caseLaw.slice(0, 5),
    economicViability,
    estimatedDamagesRange: getEstimatedDamagesRange(context.w2RangeStr),
    arguingPoints,
    riskFlags,
    agencyOptions,
    recommendedActions: generateRecommendedActions(),
    disclaimer: STANDARD_DISCLAIMER,
  };
}

function getEstimatedDamagesRange(w2RangeStr: string): string {
  const ranges: Record<string, string> = {
    'under_30k': '$5,000 - $30,000 (rough estimate)',
    '30k_50k': '$10,000 - $75,000 (rough estimate)',
    '50k_75k': '$20,000 - $150,000 (rough estimate)',
    '75k_100k': '$30,000 - $250,000 (rough estimate)',
    '100k_150k': '$50,000 - $400,000 (rough estimate)',
    'over_150k': '$75,000 - $500,000+ (rough estimate)',
    'unknown': 'Unable to estimate without income information',
  };
  return ranges[w2RangeStr] ?? 'Unable to estimate';
}

function generateRecommendedActions(): RecommendedAction[] {
  return [
    { option: 'A', label: 'Accept Direct', description: 'Accept the case for direct representation. Caller will be notified that an attorney will contact them.' },
    { option: 'B', label: 'Refer to Specialist', description: 'Refer the case to a specialist attorney in the network who handles this specific practice area.' },
    { option: 'C', label: 'Advise Self-File', description: 'Advise the caller of applicable agency filing options they can pursue independently.' },
  ];
}
