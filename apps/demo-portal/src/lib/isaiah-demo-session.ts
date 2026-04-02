/**
 * Isaiah Thompson Demo Session — replay event data
 *
 * This file contains the scripted events for the Friday attorney demo.
 * Events play back in sequence to show Justice triaging Isaiah's
 * wrongful-termination / retaliation case in real time.
 *
 * Total replay duration: ~4 minutes (240 000 ms at 1x speed).
 */

export type ElementStatus = 'pending' | 'true' | 'partial' | 'false';

export type DemoEvent = {
  timestamp: number; // ms offset from session start
  type:
    | 'transcript'
    | 'element_update'
    | 'statute_trigger'
    | 'viability_update'
    | 'call_state'
    | 'document_received'
    | 'economic_pitch';
  data: Record<string, any>;
};

export const ELEMENTS = [
  'Protected Activity',
  'Adverse Action',
  'Causal Link',
  'Employer Knowledge',
  'Temporal Proximity',
  'Damages',
] as const;

export type ElementName = (typeof ELEMENTS)[number];

export const ISAIAH_DEMO_EVENTS: DemoEvent[] = [
  // ── Call connects ──────────────────────────────────────────────────
  {
    timestamp: 0,
    type: 'call_state',
    data: { state: 'connecting', label: 'Connecting' },
  },
  {
    timestamp: 2000,
    type: 'call_state',
    data: { state: 'call_1_active', label: 'Call Active' },
  },

  // ── Opening ────────────────────────────────────────────────────────
  {
    timestamp: 3000,
    type: 'transcript',
    data: {
      speaker: 'justice',
      text: 'Thank you for calling Wolf Law. My name is Justice, and I\'m here to learn about your situation so we can connect you with the right attorney. Everything you share is confidential. Can you start by telling me what happened?',
    },
  },
  {
    timestamp: 12000,
    type: 'transcript',
    data: {
      speaker: 'plaintiff',
      text: 'Yeah, hi. My name is Isaiah Thompson. I was fired from Meridian Logistics about three weeks ago. I worked there for six years as a warehouse operations supervisor.',
    },
  },
  {
    timestamp: 22000,
    type: 'transcript',
    data: {
      speaker: 'justice',
      text: 'I\'m sorry to hear that, Isaiah. Six years is a long time. Can you walk me through what led to your termination?',
    },
  },

  // ── Protected Activity surfaces ────────────────────────────────────
  {
    timestamp: 30000,
    type: 'transcript',
    data: {
      speaker: 'plaintiff',
      text: 'About two months before they fired me, I reported safety violations to my supervisor. The dock loading equipment hadn\'t been inspected in over a year, and two workers got injured. I put it in writing — emailed my supervisor and CC\'d HR.',
    },
  },
  {
    timestamp: 42000,
    type: 'element_update',
    data: {
      element: 'Protected Activity',
      status: 'true',
      reasoning: 'Written safety complaint to supervisor and HR — protected under OSHA Section 11(c) and Illinois whistleblower statutes.',
    },
  },
  {
    timestamp: 42500,
    type: 'viability_update',
    data: { score: 17, tier: 'Developing' },
  },

  // ── Employer Knowledge ─────────────────────────────────────────────
  {
    timestamp: 45000,
    type: 'transcript',
    data: {
      speaker: 'justice',
      text: 'That email is important documentation. When you reported these safety concerns, what was the response from your supervisor and HR?',
    },
  },
  {
    timestamp: 54000,
    type: 'transcript',
    data: {
      speaker: 'plaintiff',
      text: 'My supervisor told me to stop making waves. HR scheduled a meeting but then canceled it twice. A week later I noticed my name was taken off the promotion list I\'d been on for months.',
    },
  },
  {
    timestamp: 64000,
    type: 'element_update',
    data: {
      element: 'Employer Knowledge',
      status: 'true',
      reasoning: 'Supervisor directly told Isaiah to "stop making waves" — confirms employer was aware of the protected complaint.',
    },
  },
  {
    timestamp: 64500,
    type: 'viability_update',
    data: { score: 33, tier: 'Developing' },
  },
  {
    timestamp: 65000,
    type: 'statute_trigger',
    data: {
      statute: 'OSHA 11(c)',
      label: 'OSHA Whistleblower Protection',
      color: '#f97316',
    },
  },

  // ── Adverse Action ─────────────────────────────────────────────────
  {
    timestamp: 70000,
    type: 'transcript',
    data: {
      speaker: 'justice',
      text: 'Understood. So you were removed from the promotion list. Then what happened leading to the actual termination?',
    },
  },
  {
    timestamp: 80000,
    type: 'transcript',
    data: {
      speaker: 'plaintiff',
      text: 'They started writing me up for things that never mattered before — being two minutes late from break, minor paperwork errors. In six years I had zero write-ups. Then in six weeks I had three, and they used those to fire me for "performance issues."',
    },
  },
  {
    timestamp: 92000,
    type: 'element_update',
    data: {
      element: 'Adverse Action',
      status: 'true',
      reasoning: 'Termination after pretextual write-ups. Six years of clean record followed by sudden disciplinary escalation.',
    },
  },
  {
    timestamp: 92500,
    type: 'viability_update',
    data: { score: 50, tier: 'Viable' },
  },
  {
    timestamp: 93000,
    type: 'statute_trigger',
    data: {
      statute: 'IWPA',
      label: 'Illinois Whistleblower Protection Act',
      color: '#3b82f6',
    },
  },

  // ── Temporal Proximity ─────────────────────────────────────────────
  {
    timestamp: 98000,
    type: 'transcript',
    data: {
      speaker: 'justice',
      text: 'Let me make sure I have the timeline right. You filed the safety report about two months before termination, and the write-ups started roughly a week after your report?',
    },
  },
  {
    timestamp: 108000,
    type: 'transcript',
    data: {
      speaker: 'plaintiff',
      text: 'Exactly. The first write-up came eight days after my email. I remember because I still have the dates on the copies they gave me.',
    },
  },
  {
    timestamp: 115000,
    type: 'element_update',
    data: {
      element: 'Temporal Proximity',
      status: 'true',
      reasoning: 'Eight days between protected complaint and first adverse action. Courts consistently find 1-3 months sufficient for temporal proximity.',
    },
  },
  {
    timestamp: 115500,
    type: 'viability_update',
    data: { score: 67, tier: 'Strong' },
  },

  // ── Documents received ─────────────────────────────────────────────
  {
    timestamp: 120000,
    type: 'transcript',
    data: {
      speaker: 'justice',
      text: 'Isaiah, do you have copies of these documents — the original safety email, the write-ups, your termination letter? If you can share those, it will strengthen the case package we prepare for the attorney.',
    },
  },
  {
    timestamp: 128000,
    type: 'transcript',
    data: {
      speaker: 'plaintiff',
      text: 'I have everything. The safety email, all three write-ups, my termination letter, my last two performance reviews — both were "exceeds expectations" — and my pay stubs.',
    },
  },
  {
    timestamp: 133000,
    type: 'document_received',
    data: { name: 'Safety Complaint Email', icon: 'mail' },
  },
  {
    timestamp: 136000,
    type: 'document_received',
    data: { name: 'Disciplinary Write-ups (3)', icon: 'file-warning' },
  },
  {
    timestamp: 139000,
    type: 'document_received',
    data: { name: 'Termination Letter', icon: 'file-x' },
  },
  {
    timestamp: 142000,
    type: 'document_received',
    data: { name: 'Performance Reviews (2)', icon: 'file-check' },
  },
  {
    timestamp: 145000,
    type: 'document_received',
    data: { name: 'Pay Stubs', icon: 'dollar-sign' },
  },
  {
    timestamp: 148000,
    type: 'document_received',
    data: { name: 'Employment Contract', icon: 'file-text' },
  },

  // ── Causal Link confirmed ──────────────────────────────────────────
  {
    timestamp: 152000,
    type: 'transcript',
    data: {
      speaker: 'justice',
      text: 'Those performance reviews are very helpful. Two "exceeds expectations" reviews followed by sudden write-ups right after a safety complaint — that pattern tells a clear story. Were any of the write-up reasons things you had done before without issue?',
    },
  },
  {
    timestamp: 162000,
    type: 'transcript',
    data: {
      speaker: 'plaintiff',
      text: 'Every single one. The break thing — everyone takes an extra minute or two. The paperwork error was a missing signature that my supervisor usually handles himself. They were looking for reasons.',
    },
  },
  {
    timestamp: 170000,
    type: 'element_update',
    data: {
      element: 'Causal Link',
      status: 'true',
      reasoning: 'Pretextual discipline for previously tolerated conduct, combined with temporal proximity and direct evidence of employer hostility ("stop making waves").',
    },
  },
  {
    timestamp: 170500,
    type: 'viability_update',
    data: { score: 83, tier: 'Strong' },
  },
  {
    timestamp: 171000,
    type: 'statute_trigger',
    data: {
      statute: 'SOX',
      label: 'Sarbanes-Oxley Whistleblower',
      color: '#a855f7',
    },
  },

  // ── Damages ────────────────────────────────────────────────────────
  {
    timestamp: 175000,
    type: 'transcript',
    data: {
      speaker: 'justice',
      text: 'Almost done, Isaiah. I need to understand the impact. What was your salary, and how has the termination affected you financially and otherwise?',
    },
  },
  {
    timestamp: 185000,
    type: 'transcript',
    data: {
      speaker: 'plaintiff',
      text: 'I was making $78,000 a year plus overtime, probably $85K total. I lost my health insurance — my daughter has asthma and the medication is $400 a month out of pocket now. I\'ve been applying everywhere but nothing yet. The stress has been affecting my sleep, my health. It\'s been really hard on my family.',
    },
  },
  {
    timestamp: 197000,
    type: 'element_update',
    data: {
      element: 'Damages',
      status: 'true',
      reasoning: 'Lost wages ($85K/yr), lost health insurance with dependent medical needs, emotional distress, ongoing job search. Substantial compensable damages.',
    },
  },
  {
    timestamp: 197500,
    type: 'viability_update',
    data: { score: 100, tier: 'Exceptional' },
  },
  {
    timestamp: 198000,
    type: 'statute_trigger',
    data: {
      statute: 'Title VII',
      label: 'Title VII Retaliation',
      color: '#22c55e',
    },
  },

  // ── Wrap-up ────────────────────────────────────────────────────────
  {
    timestamp: 202000,
    type: 'transcript',
    data: {
      speaker: 'justice',
      text: 'Isaiah, thank you for sharing all of that. Based on everything you\'ve told me, your case shows strong indicators across all six elements we evaluate. I\'m going to package this up right now and route it to the best-fit attorney in our network. You should hear from them within 24 hours.',
    },
  },
  {
    timestamp: 215000,
    type: 'transcript',
    data: {
      speaker: 'plaintiff',
      text: 'Thank you. I really appreciate you listening. I just want someone to take this seriously.',
    },
  },
  {
    timestamp: 222000,
    type: 'transcript',
    data: {
      speaker: 'justice',
      text: 'We take it very seriously. The attorney who reviews your case will have the full transcript, your documents, and our analysis. Take care, Isaiah.',
    },
  },

  // ── Call ends, packaging begins ────────────────────────────────────
  {
    timestamp: 226000,
    type: 'call_state',
    data: { state: 'call_1_complete', label: 'Call Complete' },
  },
  {
    timestamp: 228000,
    type: 'call_state',
    data: { state: 'packaging', label: 'Packaging Case' },
  },

  // ── Economic pitch ─────────────────────────────────────────────────
  {
    timestamp: 234000,
    type: 'economic_pitch',
    data: {
      headline: 'Isaiah Thompson v. Meridian Logistics',
      summary:
        'Six-year employee terminated eight days after filing written OSHA safety complaint. Pretextual write-ups manufactured after spotless record. All six retaliation elements confirmed with documentary evidence.',
      estimatedRange: '$180,000 - $340,000',
      statutes: ['IWPA', 'OSHA 11(c)', 'SOX', 'Title VII'],
      elements: '6 / 6 confirmed',
      documents: 6,
      viability: 100,
    },
  },

  // ── Complete ───────────────────────────────────────────────────────
  {
    timestamp: 240000,
    type: 'call_state',
    data: { state: 'complete', label: 'Complete' },
  },
];
