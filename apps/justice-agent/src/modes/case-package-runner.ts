/**
 * WS7: Case Package Runner
 * Run: cd apps/justice-agent && doppler run -- npx tsx src/modes/case-package-runner.ts
 *
 * Generates a case package from the Isaiah mock case and inserts into crm_cases.
 */

import { generateCasePackage, type CaseIntake } from './case-package-engine';
import postgres from 'postgres';

// ─── Isaiah Mock Case ────────────────────────────────────────────────────────
// Isaiah reported safety violations at a publicly traded manufacturing company.
// He was terminated 21 days after filing an internal complaint and an OSHA report.

const ISAIAH_CASE: CaseIntake = {
  caller_name: 'Isaiah Thompson',
  caller_phone: '+13125551234',
  annual_income: 92000,
  income_source: 'W-2',
  employment_type: 'Senior Quality Assurance Manager',
  tenure_years: 6,

  employer_name: 'Apex Manufacturing Corp.',
  employer_size: '500-1000 employees',
  employer_headcount: 750,
  publicly_traded: true,
  industry: 'Manufacturing',

  situation_tags: [
    'whistleblower',
    'reported_violations',
    'safety_report_retaliation',
    'osha_retaliation',
    'fired_for_complaint',
    'retaliation_for_reporting',
    'internal_complaint',
  ],
  protected_characteristics: [],
  geography: ['illinois', 'cook_county', 'chicago', 'federal'],
  worker_type: 'employee',
  employer_type: 'private',

  incident_date: '2026-03-10',
  timeline_days_ago: 22,
  incident_description: 'Isaiah Thompson, Senior QA Manager at Apex Manufacturing, discovered that the company was systematically falsifying quality inspection reports for automotive safety components shipped to major automakers. He raised concerns internally to his VP of Operations on February 15, 2026, documented the falsified reports, and filed a formal OSHA complaint on February 20, 2026. On March 10, 2026 — 21 days after his OSHA filing — Apex terminated Isaiah, citing "restructuring" despite his department showing record performance and no prior restructuring announcements.',

  call_1_transcript: `JUSTICE: Hi Isaiah, thank you for calling. I understand you're dealing with a difficult workplace situation. Can you tell me what happened?

ISAIAH: I was the Senior QA Manager at Apex Manufacturing for six years. Best performance reviews every year. Two months ago I found out my company was faking quality inspection reports — these are safety-critical automotive parts. Brake components, steering assemblies. I couldn't let that slide.

JUSTICE: That sounds very serious. What did you do when you found out?

ISAIAH: First I went to my VP, Mark Sullivan, on February 15th. Showed him the evidence — falsified batch test results, doctored inspection certificates. He told me to "let it go" and that "this is how the industry works." I told him I couldn't do that. So on February 20th I filed a formal complaint with OSHA and documented everything.

JUSTICE: And what happened after you filed the OSHA complaint?

ISAIAH: Three weeks later, March 10th, they fired me. HR called me in, said it was a "restructuring." But here's the thing — nobody else in my department was let go. No restructuring was ever announced. My department had the best numbers in the company. And my VP — the same one I reported to — was on the termination call. They didn't even try to hide it.

JUSTICE: Did you keep copies of the documents you found?

ISAIAH: Yes. I have the original falsified reports, my emails to Mark Sullivan, the OSHA complaint confirmation, my performance reviews from the last three years, and my termination letter. I also have a text message from a colleague saying "everyone knows why you were really fired."`,

  documents: [
    { name: 'Falsified Inspection Reports', type: 'evidence', summary: 'Batch test results for Q4 2025 showing altered pass/fail data for brake component lots' },
    { name: 'Email to VP Mark Sullivan', type: 'email', summary: 'February 15 email documenting safety concerns and requesting investigation' },
    { name: 'OSHA Complaint Confirmation', type: 'complaint', summary: 'OSHA complaint #2026-IL-00847 filed February 20, 2026 re: falsified safety inspections' },
    { name: 'Performance Reviews 2023-2025', type: 'performance_review', summary: 'Three consecutive years of "Exceeds Expectations" ratings with merit increases' },
    { name: 'Termination Letter', type: 'termination_letter', summary: 'March 10, 2026 letter citing "organizational restructuring" as reason for termination' },
    { name: 'Colleague Text Message', type: 'evidence', summary: 'Text from coworker stating "everyone knows why you were really fired"' },
  ],
};

// ─── Runner ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  WS7: Case Package Engine — Isaiah Mock Case');
  console.log('═══════════════════════════════════════════════════════\n');

  // Validate environment
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('FATAL: ANTHROPIC_API_KEY not set. Run via: doppler run -- npx tsx ...');
    process.exit(1);
  }

  // Generate the case package
  const pkg = await generateCasePackage(ISAIAH_CASE);

  // Print results
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  CASE PACKAGE RESULTS');
  console.log('═══════════════════════════════════════════════════════\n');

  console.log(`Plaintiff: ${pkg.plaintiff.name}`);
  console.log(`Employer:  ${pkg.employer.name} (${pkg.employer.size}, ${pkg.employer.publicly_traded ? 'publicly traded' : 'private'})`);
  console.log(`Income:    $${pkg.plaintiff.annual_income.toLocaleString()}/yr (${pkg.plaintiff.income_source})`);
  console.log(`Tenure:    ${pkg.plaintiff.tenure_years} years`);

  console.log(`\n--- Viability ---`);
  console.log(`Score: ${pkg.viability_score}/100`);
  console.log(`Tier:  ${pkg.viability_tier.toUpperCase()}`);

  console.log(`\n--- Six-Element Scores ---`);
  for (const [key, val] of Object.entries(pkg.elements)) {
    const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    console.log(`  ${val.score.toUpperCase().padEnd(7)} ${label}`);
    console.log(`          ${val.reasoning}`);
  }

  console.log(`\n--- Damages Estimate ---`);
  console.log(`  Back pay:            $${pkg.damages.back_pay_estimate.toLocaleString()}`);
  console.log(`  Front pay:           $${pkg.damages.front_pay_estimate.toLocaleString()}`);
  console.log(`  Benefits value:      $${pkg.damages.benefits_value.toLocaleString()}`);
  console.log(`  Emotional distress:  ${pkg.damages.emotional_distress_range}`);
  console.log(`  Punitive eligible:   ${pkg.damages.punitive_eligible ? 'YES' : 'No'}`);
  console.log(`  TOTAL RANGE:         $${pkg.damages.total_low.toLocaleString()} – $${pkg.damages.total_high.toLocaleString()}`);

  console.log(`\n--- Statutes (${pkg.statutes.length}) ---`);
  for (const s of pkg.statutes.slice(0, 5)) {
    console.log(`  ${s.name} (${s.citation})`);
    console.log(`    Venue: ${s.venue} | Deadline: ${s.filing_deadline}`);
  }

  console.log(`\n--- Fact Pattern ---`);
  console.log(pkg.fact_pattern.narrative.substring(0, 800) + (pkg.fact_pattern.narrative.length > 800 ? '...' : ''));

  console.log(`\n--- Evidence ---`);
  console.log(`  Has (${pkg.evidence.has.length}):`);
  pkg.evidence.has.forEach(e => console.log(`    ✓ ${e}`));
  console.log(`  Missing (${pkg.evidence.missing.length}):`);
  pkg.evidence.missing.forEach(e => console.log(`    ✗ ${e}`));

  console.log(`\n--- Employer Defenses & Counters ---`);
  for (let i = 0; i < pkg.employer_defenses.length; i++) {
    console.log(`  Defense: ${pkg.employer_defenses[i]}`);
    console.log(`  Counter: ${pkg.counter_defenses[i]}`);
    console.log();
  }

  console.log(`--- Filing Strategy ---`);
  console.log(`  Venue:    ${pkg.filing_strategy.recommended_venue}`);
  console.log(`  Reason:   ${pkg.filing_strategy.reasoning}`);
  console.log(`  Deadline: ${pkg.filing_strategy.deadline}`);

  console.log(`\n--- Economic Pitch ---`);
  console.log(`  ${pkg.economic_pitch}`);

  // ─── Insert into crm_cases ────────────────────────────────────────────────

  if (process.env.DATABASE_URL) {
    console.log('\n--- Inserting into crm_cases ---');
    const sql = postgres(process.env.DATABASE_URL);

    try {
      const claims = `{${pkg.fact_pattern.protected_claims.map(c => `"${c.replace(/"/g, '\\"')}"`).join(',')}}`;
      const [row] = await sql.unsafe(
        `INSERT INTO crm_cases (
          caller_phone, caller_name, call_1_transcript,
          documents, fact_pattern, statutes_triggered,
          viability_score, viability_tier, element_scores,
          annual_income, employer_name, employer_size, publicly_traded,
          protected_claims, status, scott_reviewed
        ) VALUES ($1,$2,$3,$4::jsonb,$5,$6::text[],$7,$8,$9::jsonb,$10,$11,$12,$13,$14::text[],$15,$16) RETURNING id`,
        [
          pkg.plaintiff.phone,
          pkg.plaintiff.name,
          ISAIAH_CASE.call_1_transcript || null,
          JSON.stringify(ISAIAH_CASE.documents),
          pkg.fact_pattern.narrative,
          claims,
          pkg.viability_score,
          pkg.viability_tier,
          JSON.stringify(pkg.elements),
          pkg.plaintiff.annual_income,
          pkg.employer.name,
          pkg.employer.size,
          pkg.employer.publicly_traded,
          claims,
          'intake',
          false,
        ]
      );
      console.log(`  ✓ Inserted crm_case: ${row.id}`);
      pkg.case_id = row.id;
    } catch (err) {
      console.error(`  ✗ Insert failed: ${err}`);
    }

    await sql.end();
  }

  // Output full JSON
  console.log('\n--- Full JSON (first 2000 chars) ---');
  const json = JSON.stringify(pkg, null, 2);
  console.log(json.substring(0, 2000));
  console.log(`\n... (${json.length} total chars)`);

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  WS7 COMPLETE');
  console.log('═══════════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
