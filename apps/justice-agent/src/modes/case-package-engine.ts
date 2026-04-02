/**
 * WS7: Case Package Engine
 *
 * Turns triaged plaintiff data into a polished, attorney-ready case package.
 * Uses the existing scoring-engine + knowledge-base packages for statute matching,
 * then layers on six-element scoring, damages calculation, fact-pattern narrative,
 * evidence inventory, defense analysis, filing strategy, and economic pitch.
 *
 * The output is a WS7CasePackage stored in the crm_cases table.
 */

import Anthropic from '@anthropic-ai/sdk';
import { matchStatutes, scoreEconomicViability, generateArguingPoints, assessRisks, getApplicableAgencies } from '@justice/scoring-engine';
import { ILLINOIS_STATUTES, queryCaseLaw } from '@justice/knowledge-base';
import type { TriageContext, ScoredStatute, EconomicViabilityScore, CaseLawResult } from '@justice/shared-types';

// ─── WS7 Types ───────────────────────────────────────────────────────────────

export type ElementScore = 'true' | 'partial' | 'false';

export interface SixElementResult {
  protected_activity: { score: ElementScore; reasoning: string; evidence: string[] };
  employer_knowledge: { score: ElementScore; reasoning: string; evidence: string[] };
  adverse_action: { score: ElementScore; reasoning: string; evidence: string[] };
  causal_connection: { score: ElementScore; reasoning: string; evidence: string[] };
  calculable_damages: { score: ElementScore; reasoning: string; evidence: string[] };
  evidence_quality: { score: ElementScore; reasoning: string; evidence: string[] };
}

export interface DamagesEstimate {
  lost_wages_annual: number;
  estimated_tenure_loss_years: number;
  back_pay_estimate: number;
  front_pay_estimate: number;
  benefits_value: number;
  emotional_distress_range: string;
  punitive_eligible: boolean;
  total_low: number;
  total_high: number;
}

export interface FactPattern {
  narrative: string;
  timeline: { date: string; event: string; source: string }[];
  protected_claims: string[];
}

export interface EvidenceInventory {
  has: string[];
  missing: string[];
  obtainable: string[];
}

export interface FilingStrategy {
  recommended_venue: string;
  reasoning: string;
  deadline: string;
  alternative_venues: string[];
}

export interface StatuteMatch {
  name: string;
  citation: string;
  relevance: string;
  filing_deadline: string;
  venue: string;
}

export interface WS7CasePackage {
  case_id?: string;
  generated_at: string;

  plaintiff: {
    name: string;
    phone: string;
    annual_income: number;
    income_source: string;
    employment_type: string;
    tenure_years: number;
  };

  employer: {
    name: string;
    size: string;
    publicly_traded: boolean;
    industry: string;
  };

  fact_pattern: FactPattern;
  elements: SixElementResult;
  viability_score: number;
  viability_tier: 'strong' | 'solid' | 'long_shot';
  statutes: StatuteMatch[];
  damages: DamagesEstimate;
  evidence: EvidenceInventory;
  employer_defenses: string[];
  counter_defenses: string[];
  filing_strategy: FilingStrategy;
  economic_pitch: string;

  // Internal metadata
  scored_statutes: ScoredStatute[];
  economic_viability: EconomicViabilityScore;
  case_law_references: CaseLawResult[];
}

// ─── Case Intake (input to the engine) ───────────────────────────────────────

export interface CaseIntake {
  // Plaintiff info
  caller_name: string;
  caller_phone: string;
  annual_income: number;
  income_source: 'W-2' | '1099' | 'stated';
  employment_type: string;
  tenure_years: number;

  // Employer info
  employer_name: string;
  employer_size: string;
  employer_headcount: number;
  publicly_traded: boolean;
  industry: string;

  // Situation
  situation_tags: string[];
  protected_characteristics: string[];
  geography: ('illinois' | 'cook_county' | 'chicago' | 'federal')[];
  worker_type: 'employee' | 'contractor' | 'temp' | 'intern' | 'any';
  employer_type: 'private' | 'public' | 'nonprofit' | 'government' | 'any';

  // Timeline
  incident_date: string;
  timeline_days_ago: number;
  incident_description: string;

  // Transcripts & documents
  call_1_transcript?: string;
  call_2_transcript?: string;
  documents?: { name: string; type: string; summary: string }[];
}

// ─── Six-Element Scoring ─────────────────────────────────────────────────────

function scoreSixElements(intake: CaseIntake, statutes: ScoredStatute[]): SixElementResult {
  const has_docs = !!intake.documents?.length;
  const has_transcripts = !!(intake.call_1_transcript || intake.call_2_transcript);
  const top_statute_names = statutes.filter(s => s.score >= 40).map(s => s.name);

  // 1. Protected Activity
  const protected_activity_tags = [
    'whistleblower', 'reported_violations', 'internal_complaint', 'safety_report_retaliation',
    'retaliation_for_reporting', 'fired_for_complaint', 'union_activity', 'concerted_activity',
    'workers_comp_retaliation', 'osha_retaliation',
  ];
  const pa_matches = intake.situation_tags.filter(t => protected_activity_tags.includes(t));
  const pa_score: ElementScore = pa_matches.length >= 2 ? 'true' : pa_matches.length === 1 ? 'partial' : 'false';
  const pa_evidence: string[] = [];
  if (pa_matches.length) pa_evidence.push(`Situation tags indicate: ${pa_matches.join(', ')}`);
  if (has_transcripts) pa_evidence.push('Call transcript available describing protected activity');
  if (has_docs) pa_evidence.push('Supporting documentation submitted');

  // 2. Employer Knowledge
  const ek_indicators = ['retaliation_for_reporting', 'fired_for_complaint', 'internal_complaint', 'osha_retaliation'];
  const ek_matches = intake.situation_tags.filter(t => ek_indicators.includes(t));
  const ek_score: ElementScore = ek_matches.length >= 1 ? 'true' : has_transcripts ? 'partial' : 'false';
  const ek_evidence: string[] = [];
  if (ek_matches.length) ek_evidence.push(`Tags suggest employer was aware: ${ek_matches.join(', ')}`);
  if (has_transcripts) ek_evidence.push('Caller described reporting to management in transcript');

  // 3. Adverse Action
  const adverse_tags = ['fired_for_complaint', 'retaliation', 'retaliation_for_reporting', 'retaliation_for_exercising_rights'];
  const aa_matches = intake.situation_tags.filter(t => adverse_tags.includes(t));
  const aa_score: ElementScore = aa_matches.length >= 1 ? 'true' : 'partial';
  const aa_evidence: string[] = [];
  if (aa_matches.length) aa_evidence.push(`Adverse action indicated: ${aa_matches.join(', ')}`);
  aa_evidence.push(`Incident description: "${intake.incident_description.substring(0, 200)}"`);

  // 4. Causal Connection (temporal proximity is the strongest indicator)
  const cc_score: ElementScore = intake.timeline_days_ago <= 30 ? 'true'
    : intake.timeline_days_ago <= 90 ? 'partial' : 'false';
  const cc_evidence: string[] = [
    `Adverse action occurred ${intake.timeline_days_ago} days after protected activity`,
  ];
  if (intake.timeline_days_ago <= 30) cc_evidence.push('Strong temporal proximity (< 30 days) supports causal inference');

  // 5. Calculable Damages
  const cd_score: ElementScore = intake.annual_income > 0 && intake.income_source === 'W-2' ? 'true'
    : intake.annual_income > 0 ? 'partial' : 'false';
  const cd_evidence: string[] = [];
  if (intake.annual_income > 0) cd_evidence.push(`Annual income: $${intake.annual_income.toLocaleString()} (${intake.income_source})`);
  if (intake.tenure_years > 0) cd_evidence.push(`Employment tenure: ${intake.tenure_years} years`);
  const fee_shifting = statutes.some(s => s.feeShifting && s.score >= 40);
  if (fee_shifting) cd_evidence.push('Fee-shifting statutes available — enhances damages recovery');

  // 6. Evidence Quality
  const eq_points = (has_docs ? 2 : 0) + (has_transcripts ? 1 : 0) + (intake.timeline_days_ago <= 90 ? 1 : 0);
  const eq_score: ElementScore = eq_points >= 3 ? 'true' : eq_points >= 1 ? 'partial' : 'false';
  const eq_evidence: string[] = [];
  if (has_docs) eq_evidence.push(`${intake.documents!.length} document(s) submitted: ${intake.documents!.map(d => d.name).join(', ')}`);
  if (has_transcripts) eq_evidence.push('Triage call transcript captured');
  if (!has_docs) eq_evidence.push('No supporting documents submitted yet');

  return {
    protected_activity: { score: pa_score, reasoning: pa_matches.length ? `Caller engaged in protected activity: ${pa_matches.join(', ')}` : 'No clear protected activity identified from intake', evidence: pa_evidence },
    employer_knowledge: { score: ek_score, reasoning: ek_score === 'true' ? 'Employer was aware of protected activity based on reporting chain' : 'Employer knowledge must be established through discovery', evidence: ek_evidence },
    adverse_action: { score: aa_score, reasoning: aa_matches.length ? `Clear adverse employment action: ${intake.incident_description.substring(0, 100)}` : 'Adverse action present but specifics need clarification', evidence: aa_evidence },
    causal_connection: { score: cc_score, reasoning: cc_score === 'true' ? `Strong temporal proximity: ${intake.timeline_days_ago} days` : `${intake.timeline_days_ago} days between activity and action — ${cc_score === 'partial' ? 'moderate' : 'weak'} temporal nexus`, evidence: cc_evidence },
    calculable_damages: { score: cd_score, reasoning: cd_score === 'true' ? `W-2 verified income of $${intake.annual_income.toLocaleString()}/yr provides clear damages baseline` : 'Income documentation needed for precise damages calculation', evidence: cd_evidence },
    evidence_quality: { score: eq_score, reasoning: eq_score === 'true' ? 'Strong documentary evidence supports the case' : eq_score === 'partial' ? 'Some evidence present; additional documentation would strengthen' : 'No documentary evidence — case relies on testimony', evidence: eq_evidence },
  };
}

// ─── Viability Score from Six Elements ───────────────────────────────────────

function computeViability(elements: SixElementResult): { score: number; tier: 'strong' | 'solid' | 'long_shot' } {
  const values = Object.values(elements);
  const trueCount = values.filter(e => e.score === 'true').length;
  const partialCount = values.filter(e => e.score === 'partial').length;

  // Score: true = 15pts, partial = 8pts, false = 0. Max = 90, then scaled to 100.
  const raw = trueCount * 15 + partialCount * 8;
  const score = Math.min(Math.round((raw / 90) * 100), 100);

  const tier: 'strong' | 'solid' | 'long_shot' = trueCount >= 5 ? 'strong'
    : trueCount >= 3 ? 'solid' : 'long_shot';

  return { score, tier };
}

// ─── Damages Calculator ──────────────────────────────────────────────────────

function calculateDamages(intake: CaseIntake, statutes: ScoredStatute[]): DamagesEstimate {
  const annual = intake.annual_income || 50000; // default to median if unknown
  const tenure = intake.tenure_years || 1;

  const back_pay_years = Math.min(intake.timeline_days_ago / 365 + 0.5, 3); // up to 3 years
  const back_pay = Math.round(annual * back_pay_years);

  const front_pay_years = Math.min(tenure * 0.5, 3); // half of tenure, capped at 3
  const front_pay = Math.round(annual * front_pay_years);

  const benefits_rate = 0.30; // standard 30% benefits multiplier
  const benefits = Math.round(annual * benefits_rate);

  const has_discrimination = intake.situation_tags.some(t =>
    ['discrimination', 'harassment', 'hostile_work_environment', 'sexual_harassment'].includes(t));
  const has_willful = intake.situation_tags.some(t =>
    ['retaliation_for_reporting', 'fired_for_complaint', 'whistleblower'].includes(t));

  const punitive_eligible = has_discrimination || has_willful;

  // Emotional distress ranges based on case severity
  const ed_low = has_discrimination ? 25000 : 10000;
  const ed_high = has_discrimination ? 150000 : 50000;

  const punitive_low = punitive_eligible ? Math.round(annual * 0.5) : 0;
  const punitive_high = punitive_eligible ? Math.round(annual * 2) : 0;

  const total_low = back_pay + front_pay + ed_low + punitive_low;
  const total_high = back_pay + front_pay + benefits + ed_high + punitive_high;

  return {
    lost_wages_annual: annual,
    estimated_tenure_loss_years: front_pay_years,
    back_pay_estimate: back_pay,
    front_pay_estimate: front_pay,
    benefits_value: benefits,
    emotional_distress_range: `$${ed_low.toLocaleString()} - $${ed_high.toLocaleString()}`,
    punitive_eligible,
    total_low,
    total_high,
  };
}

// ─── Fact Pattern Generator ──────────────────────────────────────────────────

async function generateFactPattern(intake: CaseIntake, elements: SixElementResult, statutes: ScoredStatute[]): Promise<FactPattern> {
  const anthropic = new Anthropic();

  const statute_names = statutes.filter(s => s.score >= 40).map(s => s.name).join(', ');

  const prompt = `You are a legal analyst preparing a case brief for a plaintiff-side employment attorney.

Write a 3-5 paragraph fact pattern narrative based on this intake data. Use attorney-facing language — crisp, precise, legally relevant. Do NOT render legal conclusions. Present facts only.

INTAKE DATA:
- Plaintiff: ${intake.caller_name}, employed ${intake.tenure_years} years as ${intake.employment_type}
- Employer: ${intake.employer_name} (${intake.employer_size}, ${intake.publicly_traded ? 'publicly traded' : 'private'}, ${intake.industry})
- Annual income: $${intake.annual_income.toLocaleString()} (${intake.income_source})
- Incident: ${intake.incident_description}
- Incident date: ${intake.incident_date} (${intake.timeline_days_ago} days ago)
- Situation tags: ${intake.situation_tags.join(', ')}
${intake.call_1_transcript ? `- Call 1 transcript excerpt: "${intake.call_1_transcript.substring(0, 1500)}"` : ''}
${intake.documents?.length ? `- Documents: ${intake.documents.map(d => `${d.name} (${d.type}): ${d.summary}`).join('; ')}` : ''}

Applicable statutes: ${statute_names}

Write ONLY the narrative (3-5 paragraphs). No headings, no bullet points.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const narrative = response.content[0].type === 'text' ? response.content[0].text : '';

  // Build timeline
  const timeline: { date: string; event: string; source: string }[] = [];
  timeline.push({ date: intake.incident_date, event: intake.incident_description.substring(0, 200), source: 'intake' });
  if (intake.call_1_transcript) {
    timeline.push({ date: new Date().toISOString().split('T')[0], event: 'Triage call 1 completed', source: 'triage' });
  }
  if (intake.documents?.length) {
    for (const doc of intake.documents) {
      timeline.push({ date: new Date().toISOString().split('T')[0], event: `Document submitted: ${doc.name}`, source: 'document' });
    }
  }

  const protected_claims = statutes
    .filter(s => s.score >= 40)
    .map(s => s.name);

  return { narrative, timeline, protected_claims };
}

// ─── Evidence Inventory ──────────────────────────────────────────────────────

function buildEvidenceInventory(intake: CaseIntake): EvidenceInventory {
  const has: string[] = [];
  const missing: string[] = [];
  const obtainable: string[] = [];

  // What we have
  if (intake.call_1_transcript) has.push('Triage call 1 transcript — describes incident and timeline');
  if (intake.call_2_transcript) has.push('Triage call 2 transcript — follow-up details');
  if (intake.documents?.length) {
    for (const doc of intake.documents) {
      has.push(`${doc.name} (${doc.type}) — ${doc.summary}`);
    }
  }
  if (intake.annual_income > 0) has.push(`Income verification: $${intake.annual_income.toLocaleString()}/yr via ${intake.income_source}`);
  if (intake.incident_description) has.push('Written incident description from caller');

  // What's missing
  if (!intake.documents?.some(d => d.type === 'w2')) missing.push('W-2 or pay stubs — needed for precise damages calculation');
  if (!intake.documents?.some(d => d.type === 'termination_letter')) missing.push('Termination letter or written notice of adverse action');
  if (!intake.documents?.some(d => d.type === 'performance_review')) missing.push('Performance reviews — to rebut pretext defense');
  if (!intake.documents?.some(d => d.type === 'complaint')) missing.push('Written complaint or report filed with employer');
  if (!intake.documents?.some(d => d.type === 'email')) missing.push('Email correspondence with supervisor/HR re: protected activity');

  // What's obtainable in discovery
  obtainable.push('Personnel file (IL 820 ILCS 40 — employer must provide within 7 days of request)');
  obtainable.push('Email/Slack communications between management re: plaintiff');
  obtainable.push('HR investigation records (if internal complaint was filed)');
  obtainable.push('Comparator employee data (similarly situated employees not subjected to adverse action)');
  if (intake.publicly_traded) obtainable.push('SEC filings and board communications referencing compliance concerns');

  return { has, missing, obtainable };
}

// ─── Defense Analysis ────────────────────────────────────────────────────────

function analyzeDefenses(intake: CaseIntake, elements: SixElementResult): { defenses: string[]; counters: string[] } {
  const defenses: string[] = [];
  const counters: string[] = [];

  // Legitimate business reason (always raised)
  defenses.push('Legitimate non-retaliatory business reason for adverse action (e.g., performance, restructuring, misconduct)');
  counters.push('Temporal proximity and shifting explanations undermine pretext. Request comparator data showing disparate treatment.');

  // Timeline defense
  if (intake.timeline_days_ago > 60) {
    defenses.push(`Temporal gap of ${intake.timeline_days_ago} days weakens causal inference`);
    counters.push('Continuing course of retaliatory conduct bridges the temporal gap. Document pattern of escalating adverse actions.');
  }

  // At-will employment
  defenses.push('Illinois is an at-will employment state — employer can terminate for any lawful reason');
  counters.push('At-will doctrine does not protect terminations that violate public policy or statutory protections.');

  // Documentation
  if (elements.evidence_quality.score === 'false') {
    defenses.push('Lack of documentary evidence — case relies on plaintiff testimony alone');
    counters.push('Discovery will yield employer records. Contemporaneous notes and witness testimony can corroborate.');
  }

  // Employer size
  if (intake.employer_headcount < 15) {
    defenses.push('Employer may fall below minimum employee threshold for certain federal statutes');
    counters.push('Illinois state statutes (IHRA) cover employers with 1+ employees. State claims remain fully viable.');
  }

  // Unclean hands
  if (intake.situation_tags.includes('misconduct') || intake.situation_tags.includes('performance_issues')) {
    defenses.push('After-acquired evidence or mixed-motive defense based on plaintiff conduct');
    counters.push('Mixed-motive analysis under IHRA and Title VII still allows recovery. After-acquired evidence limits but does not bar relief.');
  }

  return { defenses, counters };
}

// ─── Filing Strategy ─────────────────────────────────────────────────────────

function buildFilingStrategy(intake: CaseIntake, statutes: ScoredStatute[]): FilingStrategy {
  const top = statutes.filter(s => s.score >= 40);
  const has_federal = top.some(s => s.category === 'discrimination' || s.category === 'whistleblower');
  const has_state = top.some(s => s.category === 'retaliation' || s.category === 'wage_theft');

  // Find earliest SOL deadline
  const earliest_sol = top.reduce((min, s) => {
    const deadline_date = new Date();
    deadline_date.setDate(deadline_date.getDate() + (s.solDays - intake.timeline_days_ago));
    return deadline_date < min ? deadline_date : min;
  }, new Date('2099-01-01'));

  const deadline_str = earliest_sol.toISOString().split('T')[0];

  let venue: string;
  let reasoning: string;
  const alternatives: string[] = [];

  if (has_federal && intake.employer_headcount >= 15) {
    venue = 'U.S. District Court, Northern District of Illinois';
    reasoning = 'Federal claims (Title VII / Dodd-Frank / SOX) provide strongest remedies and fee-shifting. EEOC right-to-sue letter required first.';
    alternatives.push('Illinois Human Rights Commission (IHRA claims)');
    alternatives.push('Cook County Circuit Court (state law claims)');
  } else if (intake.geography.includes('chicago')) {
    venue = 'Cook County Circuit Court';
    reasoning = 'State claims under IHRA and Chicago ordinances provide broad coverage with favorable Illinois jury pools.';
    alternatives.push('Illinois Human Rights Commission');
    if (intake.employer_headcount >= 15) alternatives.push('EEOC (for federal parallel filing)');
  } else {
    venue = 'Circuit Court of Illinois';
    reasoning = 'State court provides efficient forum for Illinois statutory claims with fee-shifting remedies.';
    alternatives.push('IDOL complaint (wage claims)');
    alternatives.push('IDHR charge (discrimination claims)');
  }

  return {
    recommended_venue: venue,
    reasoning,
    deadline: deadline_str,
    alternative_venues: alternatives,
  };
}

// ─── Economic Pitch Generator ────────────────────────────────────────────────

function generateEconomicPitch(intake: CaseIntake, damages: DamagesEstimate, elements: SixElementResult, statutes: ScoredStatute[]): string {
  const true_count = Object.values(elements).filter(e => e.score === 'true').length;
  const fee_shifting = statutes.some(s => s.feeShifting && s.score >= 40);
  const tier = true_count >= 5 ? 'strong' : true_count >= 3 ? 'solid' : 'developing';

  const parts: string[] = [];

  parts.push(`${intake.caller_name.split(' ')[0]}'s case against ${intake.employer_name} scores ${tier} on ${true_count}/6 legal elements with estimated damages of $${damages.total_low.toLocaleString()}–$${damages.total_high.toLocaleString()}.`);

  if (fee_shifting) {
    parts.push(`Fee-shifting statutes apply — attorney fees recoverable on top of damages.`);
  }

  if (damages.punitive_eligible) {
    parts.push(`Punitive damages are in play given the ${intake.situation_tags.includes('whistleblower') ? 'retaliatory' : 'discriminatory'} nature of the adverse action.`);
  }

  if (intake.publicly_traded) {
    parts.push(`${intake.employer_name} is publicly traded — deep pockets and compliance sensitivity favor early settlement.`);
  }

  return parts.join(' ');
}

// ─── Statute Mapping for WS7 format ─────────────────────────────────────────

function mapStatutesForPackage(statutes: ScoredStatute[], intake: CaseIntake): StatuteMatch[] {
  return statutes.filter(s => s.score >= 20).map(s => {
    const deadline_date = new Date();
    deadline_date.setDate(deadline_date.getDate() + (s.solDays - intake.timeline_days_ago));

    let venue = 'state court';
    if (s.agencyFiling) venue = s.agencyFiling.acronym;
    if (s.category === 'discrimination' && intake.employer_headcount >= 15) venue = 'EEOC / federal court';
    if (s.category === 'whistleblower') venue = 'DOL / federal court';

    return {
      name: s.name,
      citation: s.citation,
      relevance: s.matchReasons.join('; '),
      filing_deadline: `${deadline_date.toISOString().split('T')[0]} (${s.solDays} days SOL)`,
      venue,
    };
  });
}

// ─── Main Engine ─────────────────────────────────────────────────────────────

export async function generateCasePackage(intake: CaseIntake): Promise<WS7CasePackage> {
  console.log('[WS7] Starting case package generation...');

  // Step 1: Build TriageContext for existing scoring engine
  const w2Range = intake.annual_income < 30000 ? 'under_30k'
    : intake.annual_income < 50000 ? '30k_50k'
    : intake.annual_income < 75000 ? '50k_75k'
    : intake.annual_income < 100000 ? '75k_100k'
    : intake.annual_income < 150000 ? '100k_150k'
    : 'over_150k';

  const context: TriageContext = {
    sessionId: `ws7-${Date.now()}`,
    tenantId: 'wolf-law',
    situationTags: intake.situation_tags,
    employerSize: intake.employer_headcount,
    employerType: intake.employer_type,
    geography: intake.geography,
    workerType: intake.worker_type,
    protectedCharacteristics: intake.protected_characteristics,
    w2RangeStr: w2Range,
    timelineDaysAgo: intake.timeline_days_ago,
    documentationPresent: !!intake.documents?.length,
    incidentDescription: intake.incident_description,
    callerPreferredContact: 'call',
  };

  // Step 2: Statute matching
  console.log('[WS7] Matching statutes...');
  const scored_statutes = matchStatutes(ILLINOIS_STATUTES, context);
  console.log(`[WS7] Matched ${scored_statutes.length} statutes (${scored_statutes.filter(s => s.score >= 40).length} viable)`);

  // Step 3: Economic viability
  const economic_viability = scoreEconomicViability(context, scored_statutes);
  console.log(`[WS7] Economic viability: ${economic_viability.label} (${economic_viability.score})`);

  // Step 4: Case law
  console.log('[WS7] Querying case law...');
  const top_statutes = scored_statutes.slice(0, 3);
  const case_law: CaseLawResult[] = [];
  for (const statute of top_statutes) {
    const results = await queryCaseLaw(statute.citation, [statute.category], 'illinois');
    case_law.push(...results);
  }
  const unique_case_law = case_law.filter((c, i, arr) => arr.findIndex(x => x.citation === c.citation) === i).slice(0, 5);

  // Step 5: Six-element scoring
  console.log('[WS7] Scoring six elements...');
  const elements = scoreSixElements(intake, scored_statutes);
  const { score: viability_score, tier: viability_tier } = computeViability(elements);
  const true_count = Object.values(elements).filter(e => e.score === 'true').length;
  console.log(`[WS7] Viability: ${viability_tier} (${viability_score}/100, ${true_count}/6 elements true)`);

  // Step 6: Damages
  console.log('[WS7] Calculating damages...');
  const damages = calculateDamages(intake, scored_statutes);
  console.log(`[WS7] Damages range: $${damages.total_low.toLocaleString()} – $${damages.total_high.toLocaleString()}`);

  // Step 7: Fact pattern (uses Claude)
  console.log('[WS7] Generating fact pattern narrative...');
  const fact_pattern = await generateFactPattern(intake, elements, scored_statutes);

  // Step 8: Evidence inventory
  const evidence = buildEvidenceInventory(intake);

  // Step 9: Defense analysis
  const { defenses: employer_defenses, counters: counter_defenses } = analyzeDefenses(intake, elements);

  // Step 10: Filing strategy
  const filing_strategy = buildFilingStrategy(intake, scored_statutes);

  // Step 11: Statute mapping
  const statutes = mapStatutesForPackage(scored_statutes, intake);

  // Step 12: Economic pitch
  const economic_pitch = generateEconomicPitch(intake, damages, elements, scored_statutes);

  console.log('[WS7] Case package complete.');

  return {
    generated_at: new Date().toISOString(),
    plaintiff: {
      name: intake.caller_name,
      phone: intake.caller_phone,
      annual_income: intake.annual_income,
      income_source: intake.income_source,
      employment_type: intake.employment_type,
      tenure_years: intake.tenure_years,
    },
    employer: {
      name: intake.employer_name,
      size: intake.employer_size,
      publicly_traded: intake.publicly_traded,
      industry: intake.industry,
    },
    fact_pattern,
    elements,
    viability_score,
    viability_tier,
    statutes,
    damages,
    evidence,
    employer_defenses,
    counter_defenses,
    filing_strategy,
    economic_pitch,
    scored_statutes,
    economic_viability,
    case_law_references: unique_case_law,
  };
}
