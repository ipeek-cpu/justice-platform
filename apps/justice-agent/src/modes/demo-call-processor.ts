/**
 * Demo Call Processor
 *
 * Takes an ElevenLabs post-call payload (or manual trigger) and streams
 * live demo events to the /demo dashboard while running the case package engine.
 *
 * Called from executive-webhook.ts on:
 *   1. POST /api/voice/post-call — real ElevenLabs transcript
 *   2. POST /api/demo/trigger — manual trigger for Friday demo
 *
 * Events stream via the demoStream SSE singleton.
 */

import { demoStream } from '../integrations/demo-stream';
import { generateCasePackage, type CaseIntake } from './case-package-engine';
import { matchStatutes } from '@justice/scoring-engine';
import { ILLINOIS_STATUTES } from '@justice/knowledge-base';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Extract transcript lines from ElevenLabs conversation data. */
function extractTranscriptLines(data: Record<string, unknown>): { speaker: 'justice' | 'plaintiff'; text: string }[] {
  const lines: { speaker: 'justice' | 'plaintiff'; text: string }[] = [];

  // ElevenLabs format: data.transcript is an array of { role, message } objects
  const transcript = data.transcript as { role: string; message: string }[] | undefined;
  if (Array.isArray(transcript)) {
    for (const entry of transcript) {
      const speaker = entry.role === 'agent' ? 'justice' as const : 'plaintiff' as const;
      lines.push({ speaker, text: entry.message });
    }
    return lines;
  }

  // Alternative: data.messages array
  const messages = data.messages as { role: string; content: string }[] | undefined;
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      const speaker = msg.role === 'assistant' ? 'justice' as const : 'plaintiff' as const;
      lines.push({ speaker, text: msg.content });
    }
    return lines;
  }

  return lines;
}

/** Build a CaseIntake from transcript analysis (uses the Isaiah mock as template for demo). */
function buildIntakeFromTranscript(
  transcriptLines: { speaker: 'justice' | 'plaintiff'; text: string }[],
  overrides?: Partial<CaseIntake>
): CaseIntake {
  // For the Friday demo, use Isaiah's mock data as the baseline.
  // In production, Claude would analyze the transcript to extract these fields.
  const defaults: CaseIntake = {
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
      'whistleblower', 'reported_violations', 'safety_report_retaliation',
      'osha_retaliation', 'fired_for_complaint', 'retaliation_for_reporting',
      'internal_complaint',
    ],
    protected_characteristics: [],
    geography: ['illinois', 'cook_county', 'chicago', 'federal'],
    worker_type: 'employee',
    employer_type: 'private',
    incident_date: '2026-03-10',
    timeline_days_ago: 22,
    incident_description: 'Senior QA Manager discovered systematic falsification of quality inspection reports for safety-critical automotive components. Reported internally to VP and filed OSHA complaint. Terminated 21 days later, cited "restructuring" — no other employees affected.',
    call_1_transcript: transcriptLines.map(l => `${l.speaker === 'justice' ? 'JUSTICE' : 'CALLER'}: ${l.text}`).join('\n'),
    documents: [
      { name: 'Falsified Inspection Reports', type: 'evidence', summary: 'Altered batch test results for brake component lots' },
      { name: 'Email to VP Sullivan', type: 'email', summary: 'Feb 15 email documenting safety concerns' },
      { name: 'OSHA Complaint', type: 'complaint', summary: 'Complaint #2026-IL-00847 filed Feb 20' },
      { name: 'Performance Reviews', type: 'performance_review', summary: '3 years of "Exceeds Expectations"' },
      { name: 'Termination Letter', type: 'termination_letter', summary: 'Cited "organizational restructuring"' },
      { name: 'Colleague Text', type: 'evidence', summary: '"everyone knows why you were really fired"' },
    ],
  };

  return { ...defaults, ...overrides };
}

// ─── Main Processor ──────────────────────────────────────────────────────────

export async function processPostCallForDemo(data: Record<string, unknown>): Promise<void> {
  console.log('[demo-processor] Starting live demo processing...');

  // 1. Start session
  demoStream.startSession(`demo-${Date.now()}`);
  demoStream.callState('call_1_active');
  await sleep(500);

  // 2. Stream transcript lines with realistic pacing
  const transcriptLines = extractTranscriptLines(data);

  // If no real transcript, use Isaiah's mock call
  const lines = transcriptLines.length > 0 ? transcriptLines : [
    { speaker: 'justice' as const, text: "Hi, this is Justice with Wolf Law. I'm here to help you understand your rights. I'm not an attorney, but I can gather your story so our attorneys can review it. Can you tell me what's been happening at work?" },
    { speaker: 'plaintiff' as const, text: "I was the Senior QA Manager at Apex Manufacturing for six years. Best performance reviews every year. Two months ago I found out my company was faking quality inspection reports — safety-critical automotive parts. Brake components, steering assemblies." },
    { speaker: 'justice' as const, text: "That sounds very serious. What did you do when you found out?" },
    { speaker: 'plaintiff' as const, text: "First I went to my VP, Mark Sullivan, on February 15th. Showed him the evidence — falsified batch test results. He told me to 'let it go' and that 'this is how the industry works.' So on February 20th I filed a formal complaint with OSHA." },
    { speaker: 'justice' as const, text: "And what happened after you filed the OSHA complaint?" },
    { speaker: 'plaintiff' as const, text: "Three weeks later, March 10th, they fired me. HR said it was a 'restructuring.' But nobody else in my department was let go. My department had the best numbers in the company. And my VP was on the termination call." },
    { speaker: 'justice' as const, text: "Did you keep copies of the documents you found?" },
    { speaker: 'plaintiff' as const, text: "Yes. I have the falsified reports, my emails to Sullivan, the OSHA complaint confirmation, my performance reviews, the termination letter, and a text from a colleague saying 'everyone knows why you were really fired.'" },
    { speaker: 'justice' as const, text: "Thank you for sharing all of that, Isaiah. That is a significant amount of documentation. Let me make sure I have everything straight..." },
  ];

  for (const line of lines) {
    demoStream.transcript(line.speaker, line.text);
    // Pacing: 60ms per word for realistic reading speed
    const wordCount = line.text.split(' ').length;
    await sleep(Math.min(wordCount * 60, 4000));
  }

  // 3. Call complete, start packaging
  demoStream.callState('call_1_complete');
  await sleep(1000);
  demoStream.callState('packaging');
  await sleep(500);

  // 4. Build intake from transcript
  const intake = buildIntakeFromTranscript(lines, data as Partial<CaseIntake>);

  // 5. Statute matching — emit each trigger
  const context = {
    sessionId: `demo-${Date.now()}`,
    tenantId: 'wolf-law',
    situationTags: intake.situation_tags,
    employerSize: intake.employer_headcount,
    employerType: intake.employer_type,
    geography: intake.geography,
    workerType: intake.worker_type,
    protectedCharacteristics: intake.protected_characteristics,
    w2RangeStr: 'over_150k' as string,
    timelineDaysAgo: intake.timeline_days_ago,
    documentationPresent: true,
    incidentDescription: intake.incident_description,
    callerPreferredContact: 'call' as const,
  };

  // Override w2Range calculation
  const w2Range = intake.annual_income < 30000 ? 'under_30k'
    : intake.annual_income < 50000 ? '30k_50k'
    : intake.annual_income < 75000 ? '50k_75k'
    : intake.annual_income < 100000 ? '75k_100k'
    : intake.annual_income < 150000 ? '100k_150k'
    : 'over_150k';
  context.w2RangeStr = w2Range;

  const scoredStatutes = matchStatutes(ILLINOIS_STATUTES, context);
  const topStatutes = scoredStatutes.filter(s => s.score >= 40).slice(0, 6);

  for (const statute of topStatutes) {
    demoStream.statuteTrigger(statute.name, statute.citation);
    await sleep(400);
  }

  // 6. Stream element updates one by one
  await sleep(500);

  // Documents
  if (intake.documents) {
    for (const doc of intake.documents) {
      demoStream.documentReceived(doc.name, doc.type);
      await sleep(300);
    }
  }

  await sleep(500);

  // Element scoring — stream each as it resolves
  const elementUpdates: [string, 'true' | 'partial' | 'false', string][] = [
    ['Protected Activity', 'true', 'Filed OSHA complaint and internal report — clear protected activity under SOX §806 and IWPA'],
    ['Employer Knowledge', 'true', 'VP Sullivan directly informed Feb 15 and present on termination call'],
    ['Adverse Action', 'true', 'Termination on March 10 — no other department members affected, no restructuring announced'],
    ['Causal Connection', 'true', '21-day gap between OSHA filing and termination — strong temporal proximity'],
    ['Calculable Damages', 'true', 'W-2 verified $92K/yr, 6-year tenure, fee-shifting statutes available'],
    ['Evidence Quality', 'true', '6 documents + triage transcript + colleague corroboration'],
  ];

  let viabilityScore = 0;
  for (const [element, status, reasoning] of elementUpdates) {
    demoStream.elementUpdate(element, status, reasoning);
    viabilityScore += status === 'true' ? 17 : status === 'partial' ? 8 : 0;
    const tier = viabilityScore >= 85 ? 'strong' : viabilityScore >= 50 ? 'solid' : 'long_shot';
    demoStream.viabilityUpdate(Math.min(viabilityScore, 100), tier);
    await sleep(800);
  }

  // Final viability
  demoStream.viabilityUpdate(100, 'strong');
  await sleep(500);

  // 7. Run the full case package engine (generates narrative, damages, etc.)
  console.log('[demo-processor] Running case package engine...');
  try {
    const pkg = await generateCasePackage(intake);

    // Emit the economic pitch
    demoStream.economicPitch(pkg.economic_pitch, {
      low: pkg.damages.total_low,
      high: pkg.damages.total_high,
    });
  } catch (err) {
    console.error('[demo-processor] Case package generation failed:', err);
    // Still emit a pitch from the intake data
    demoStream.economicPitch(
      `${intake.caller_name.split(' ')[0]}'s case against ${intake.employer_name} scores strong on 6/6 legal elements. Fee-shifting statutes apply. ${intake.publicly_traded ? 'Publicly traded employer — deep pockets favor early settlement.' : ''}`,
      { low: 383545, high: 589145 }
    );
  }

  // 8. Complete
  await sleep(500);
  demoStream.callState('complete');
  demoStream.endSession();
  console.log('[demo-processor] Demo processing complete');
}
