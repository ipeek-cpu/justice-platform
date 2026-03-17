import type { ScoredStatute, EconomicViabilityScore } from './triage';

export interface CaseLawResult {
  caseName: string;
  citation: string;
  year: number;
  court: string;
  holding: string;
  relevanceScore: number;
  sourceUrl?: string;
}

export interface ArguingPoint {
  text: string;
  supportingStatute?: string;
  strength: 'strong' | 'moderate' | 'supportive';
}

export interface RiskFlag {
  text: string;
  severity: 'high' | 'medium' | 'low';
  mitigationNote?: string;
}

export interface CasePackage {
  sessionId: string;
  tenantId: string;
  createdAt: string;
  geography: string[];
  dealSummary: string;
  primaryStatutes: ScoredStatute[];
  secondaryStatutes: ScoredStatute[];
  possibleStatutes: ScoredStatute[];
  caseLawReferences: CaseLawResult[];
  economicViability: EconomicViabilityScore;
  estimatedDamagesRange?: string;
  arguingPoints: ArguingPoint[];
  riskFlags: RiskFlag[];
  agencyOptions: AgencyOptionSummary[];
  recommendedActions: RecommendedAction[];
  disclaimer: string;
}

export interface AgencyOptionSummary {
  agencyName: string;
  acronym: string;
  url: string;
  claimType: string;
  deadline: string;
  callerCanSelfFile: boolean;
}

export interface RecommendedAction {
  option: 'A' | 'B' | 'C';
  label: string;
  description: string;
}

export interface TransparencyEntry {
  statuteName: string;
  citation: string;
  finalScore: number;
  tier: 'primary' | 'secondary' | 'possible' | 'excluded';
  scoreBreakdown: {
    hardThreshold: number;
    tagOverlap: number;
    characteristicMatch: number;
    withinSOL: number;
    feeShifting: number;
    economicSignal: number;
  };
  reasoning: string;
}
