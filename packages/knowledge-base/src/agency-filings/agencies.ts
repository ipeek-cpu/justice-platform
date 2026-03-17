import type { AgencyOption } from '@justice/shared-types';

export const AGENCY_IDOL: AgencyOption = {
  name: 'Illinois Department of Labor',
  acronym: 'IDOL',
  url: 'https://labor.illinois.gov/',
  claimType: 'Wage complaint',
  timeLimitDays: 365,
  timeLimitDescription: '1 year from the date of the violation',
  callerCanSelfFile: true,
  applicabilityConditions: [
    { field: 'situationTags', operator: 'includes', value: 'wage_theft', description: 'Situation involves wage-related claims' },
    { field: 'score', operator: 'gte', value: 40, description: 'Case score meets minimum threshold' },
  ],
};

export const AGENCY_IDHR: AgencyOption = {
  name: 'Illinois Department of Human Rights',
  acronym: 'IDHR',
  url: 'https://dhr.illinois.gov/',
  claimType: 'Discrimination charge',
  timeLimitDays: 300,
  timeLimitDescription: '300 days from the date of the discriminatory act',
  callerCanSelfFile: true,
  applicabilityConditions: [
    { field: 'situationTags', operator: 'includes', value: 'discrimination', description: 'Situation involves discrimination claims' },
    { field: 'protectedCharacteristics', operator: 'exists', value: true, description: 'At least one protected characteristic identified' },
    { field: 'score', operator: 'gte', value: 40, description: 'Case score meets minimum threshold' },
  ],
};

export const AGENCY_OSHA: AgencyOption = {
  name: 'Occupational Safety and Health Administration',
  acronym: 'OSHA',
  url: 'https://www.osha.gov/',
  claimType: 'Safety complaint / whistleblower retaliation',
  timeLimitDays: 30,
  timeLimitDescription: '30 days from the retaliatory action for whistleblower claims',
  callerCanSelfFile: true,
  applicabilityConditions: [
    { field: 'situationTags', operator: 'includes', value: 'safety_report_retaliation', description: 'Situation involves retaliation for safety reporting' },
  ],
};

export const AGENCY_NLRB: AgencyOption = {
  name: 'National Labor Relations Board',
  acronym: 'NLRB',
  url: 'https://www.nlrb.gov/',
  claimType: 'Unfair labor practice charge',
  timeLimitDays: 180,
  timeLimitDescription: '6 months from the unfair labor practice',
  callerCanSelfFile: true,
  applicabilityConditions: [
    { field: 'situationTags', operator: 'includes', value: 'union_activity', description: 'Situation involves union or concerted activity' },
  ],
};

export const AGENCY_EEOC: AgencyOption = {
  name: 'Equal Employment Opportunity Commission',
  acronym: 'EEOC',
  url: 'https://www.eeoc.gov/',
  claimType: 'Discrimination charge',
  timeLimitDays: 300,
  timeLimitDescription: '300 days from the discriminatory act (with state agency cross-filing)',
  callerCanSelfFile: true,
  applicabilityConditions: [
    { field: 'situationTags', operator: 'includes', value: 'discrimination', description: 'Situation involves discrimination claims' },
    { field: 'protectedCharacteristics', operator: 'exists', value: true, description: 'At least one protected characteristic identified' },
    { field: 'employerSize', operator: 'gte', value: 15, description: 'Employer has 15+ employees' },
  ],
};
