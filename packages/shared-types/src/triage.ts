export type StatuteCategory =
  | 'retaliation'
  | 'wage_theft'
  | 'discrimination'
  | 'whistleblower'
  | 'safety'
  | 'leave'
  | 'union_activity'
  | 'workers_comp'
  | 'unemployment'
  | 'privacy'
  | 'contract';

export type EmployerType = 'private' | 'public' | 'nonprofit' | 'government' | 'any';
export type Geography = 'illinois' | 'cook_county' | 'chicago' | 'federal';
export type WorkerType = 'employee' | 'contractor' | 'temp' | 'intern' | 'any';

export interface TriageContext {
  sessionId: string;
  tenantId: string;
  situationTags: string[];
  employerSize: number;
  employerType: EmployerType;
  geography: Geography[];
  workerType: WorkerType;
  protectedCharacteristics: string[];
  w2RangeStr: string;
  timelineDaysAgo: number;
  documentationPresent: boolean;
  incidentDescription: string;
  callerPreferredContact: 'call' | 'text';
}

export interface ScoredStatute {
  id: string;
  name: string;
  citation: string;
  category: StatuteCategory;
  score: number;
  tier: 'primary' | 'secondary' | 'possible';
  matchReasons: string[];
  feeShifting: boolean;
  solDays: number;
  agencyFiling?: AgencyOption;
  docBonus: number;
}

export interface AgencyOption {
  name: string;
  acronym: string;
  url: string;
  claimType: string;
  timeLimitDays: number;
  timeLimitDescription: string;
  callerCanSelfFile: boolean;
  applicabilityConditions: ApplicabilityCondition[];
}

export interface ApplicabilityCondition {
  field: string;
  operator: 'includes' | 'gte' | 'eq' | 'exists';
  value: string | number | boolean;
  description: string;
}

export interface EconomicViabilityScore {
  score: number;
  w2RangeStr: string;
  feeShiftingAvailable: boolean;
  documentationPresent: boolean;
  contingencyViable: boolean;
  label: 'Strong' | 'Viable' | 'Possible' | 'Weak';
}
