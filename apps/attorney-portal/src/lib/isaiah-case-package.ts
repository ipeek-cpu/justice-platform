/**
 * WS7 Isaiah Thompson case package -- full structured data for the attorney portal.
 *
 * Compliance: Plaintiff name is redacted to "Plaintiff A". Income shown as range.
 * No phone numbers. No PII beyond what attorneys need for case evaluation.
 */

export const ISAIAH_CASE = {
  id: '9e65d4bf-7bd7-4b80-b666-a4ddf220b7fc',
  generated_at: '2026-04-02T00:40:14.886Z',

  plaintiff: {
    display_name: 'Plaintiff A',
    annual_income_range: '$75K\u2013$100K',
    income_source: 'W-2',
    employment_type: 'Senior Quality Assurance Manager',
    tenure_years: 6,
  },

  employer: {
    name: 'Apex Manufacturing Corp.',
    size: '500-1000 employees',
    publicly_traded: true,
    industry: 'Manufacturing',
  },

  viability_score: 100,
  viability_tier: 'strong' as const,

  elements: {
    protected_activity: {
      score: 'true' as const,
      reasoning:
        'Filed OSHA complaint and internal report re: falsified safety inspections',
      evidence: [
        'OSHA complaint #2026-IL-00847',
        'Email to VP Mark Sullivan dated Feb 15, 2026',
        'Falsified inspection reports',
      ],
    },
    employer_knowledge: {
      score: 'true' as const,
      reasoning:
        'VP Sullivan directly informed Feb 15; told plaintiff to "let it go"',
      evidence: ['Email chain with VP', 'VP present on termination call'],
    },
    adverse_action: {
      score: 'true' as const,
      reasoning:
        'Terminated March 10, 2026. No other department members terminated. No restructuring announced.',
      evidence: [
        'Termination letter citing "restructuring"',
        'No other layoffs in department',
      ],
    },
    causal_connection: {
      score: 'true' as const,
      reasoning:
        '21-day gap between OSHA filing and termination \u2014 strong temporal proximity',
      evidence: [
        'OSHA filing: Feb 20',
        'Termination: Mar 10',
        'Colleague text: "everyone knows why you were really fired"',
      ],
    },
    calculable_damages: {
      score: 'true' as const,
      reasoning:
        'W-2 verified income ($75K\u2013$100K range), 6-year tenure, fee-shifting statutes available',
      evidence: [
        'W-2 income documentation',
        '3 years of performance reviews with merit increases',
      ],
    },
    evidence_quality: {
      score: 'true' as const,
      reasoning:
        'Extensive documentary evidence including falsified reports, OSHA confirmation, emails, performance reviews, termination letter, witness corroboration',
      evidence: [
        '6 documents submitted',
        'Triage call transcript',
        'Colleague corroboration text',
      ],
    },
  },

  economic_pitch:
    "Plaintiff A's case against Apex Manufacturing Corp. scores strong on 6/6 legal elements with estimated damages of $383,545\u2013$589,145. Fee-shifting statutes apply \u2014 attorney fees recoverable on top of damages. Punitive damages are in play given the retaliatory nature of the adverse action. Apex Manufacturing Corp. is publicly traded \u2014 deep pockets and compliance sensitivity favor early settlement.",

  damages: {
    back_pay_estimate: 51545,
    front_pay_estimate: 276000,
    benefits_value: 27600,
    emotional_distress_range: '$10,000 \u2013 $50,000',
    punitive_eligible: true,
    total_low: 383545,
    total_high: 589145,
  },

  fact_pattern: {
    narrative: `Plaintiff A was employed as a Senior Quality Assurance Manager at Apex Manufacturing Corp., a publicly traded manufacturing company employing between 500 and 1,000 individuals, for approximately six years prior to termination. Throughout their tenure, the plaintiff consistently received "Exceeds Expectations" performance ratings with merit-based compensation increases.

In early 2026, the plaintiff discovered systematic falsification of quality inspection reports for safety-critical automotive components \u2014 brake components and steering assemblies shipped to major automakers. On February 15, 2026, the plaintiff reported this to VP of Operations Mark Sullivan, presenting documentary evidence. Sullivan told the plaintiff to "let it go," characterizing the conduct as standard industry practice.

On February 20, 2026, the plaintiff filed formal OSHA Complaint #2026-IL-00847. Twenty-one days later, on March 10, 2026, Apex terminated the plaintiff, citing "organizational restructuring." No other employees in the plaintiff's department were terminated, no restructuring had been announced, and the department had the strongest performance metrics in the company. The VP who received the initial report was present on the termination call.

The plaintiff possesses the original falsified inspection reports, email correspondence with Sullivan, OSHA complaint confirmation, three years of performance reviews, the termination letter, and a text message from a colleague stating "everyone knows why you were really fired."`,
    timeline: [
      {
        date: '2020-03',
        event: 'Hired as QA Manager at Apex Manufacturing',
        source: 'intake',
      },
      {
        date: '2026-02-15',
        event: 'Reported falsified inspection reports to VP Sullivan',
        source: 'email',
      },
      {
        date: '2026-02-20',
        event: 'Filed OSHA Complaint #2026-IL-00847',
        source: 'osha',
      },
      {
        date: '2026-03-10',
        event: 'Terminated \u2014 cited "organizational restructuring"',
        source: 'termination_letter',
      },
      {
        date: '2026-03-31',
        event: 'Triage call completed',
        source: 'triage',
      },
    ],
    protected_claims: [
      'Illinois Whistleblower Act',
      'SOX \u00a7806',
      'OSHA Retaliation',
      'Illinois Human Rights Act',
      'Title VII Retaliation',
    ],
  },

  statutes: [
    {
      name: 'Illinois Whistleblower Act',
      citation: '740 ILCS 174',
      filing_deadline: '2027-03-10',
      venue: 'State Court / DOL',
    },
    {
      name: 'SOX \u00a7806 Whistleblower Protection',
      citation: '18 U.S.C. \u00a71514A',
      filing_deadline: '2026-09-07',
      venue: 'DOL / Federal Court',
    },
    {
      name: 'Illinois Human Rights Act',
      citation: '775 ILCS 5',
      filing_deadline: '2027-01-05',
      venue: 'IDHR / Circuit Court',
    },
    {
      name: 'Title VII Retaliation',
      citation: '42 U.S.C. \u00a72000e-3',
      filing_deadline: '2027-01-05',
      venue: 'EEOC / Federal Court',
    },
    {
      name: 'OSHA Whistleblower Protection',
      citation: '11(c) OSH Act',
      filing_deadline: '2026-04-10',
      venue: 'OSHA / DOL',
    },
  ],

  evidence: {
    has: [
      'Falsified inspection reports (Q4 2025 batch test results)',
      'Email to VP Mark Sullivan (Feb 15, 2026)',
      'OSHA Complaint #2026-IL-00847 confirmation',
      'Performance reviews 2023\u20132025 ("Exceeds Expectations")',
      'Termination letter (Mar 10, 2026)',
      'Colleague text message corroboration',
      'Triage call transcript',
    ],
    missing: [
      'W-2 / pay stubs for precise damages',
      'HR investigation file (if any)',
    ],
    obtainable: [
      'Personnel file (IL 820 ILCS 40 \u2014 employer must provide within 7 days)',
      'Internal emails between management re: plaintiff',
      'Comparator employee data',
      'SEC filings referencing compliance concerns',
    ],
  },

  employer_defenses: [
    'Legitimate restructuring \u2014 business necessity',
    'Illinois at-will employment doctrine',
  ],
  counter_defenses: [
    'No other employees terminated. No restructuring announced. Record department performance. VP who received report was on termination call \u2014 pretext is clear.',
    'At-will doctrine does not protect terminations violating public policy (whistleblower statutes).',
  ],

  filing_strategy: {
    recommended_venue:
      'U.S. District Court, Northern District of Illinois',
    reasoning:
      'Federal claims (SOX \u00a7806) provide strongest remedies and fee-shifting. Dual-file with state claims for maximum leverage.',
    deadline: '2026-09-07',
    alternative_venues: [
      'Illinois Human Rights Commission',
      'Cook County Circuit Court',
    ],
  },
};

/** Short-form abbreviations for statute pills in the case list view. */
export const STATUTE_ABBREVIATIONS: Record<string, string> = {
  'Illinois Whistleblower Act': 'IWPA',
  'SOX \u00a7806 Whistleblower Protection': 'SOX',
  'Illinois Human Rights Act': 'IHRA',
  'Title VII Retaliation': 'Title VII',
  'OSHA Whistleblower Protection': 'OSHA',
};

/** Element display names for the six-element grid. */
export const ELEMENT_LABELS: Record<string, string> = {
  protected_activity: 'Protected Activity',
  employer_knowledge: 'Employer Knowledge',
  adverse_action: 'Adverse Action',
  causal_connection: 'Causal Connection',
  calculable_damages: 'Calculable Damages',
  evidence_quality: 'Evidence Quality',
};
