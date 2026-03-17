import { TransparencyLog } from '@/components/TransparencyLog';

const MOCK_LOG = [
  {
    statuteName: 'Illinois Whistleblower Act',
    citation: '740 ILCS 174',
    finalScore: 82,
    tier: 'primary' as const,
    scoreBreakdown: { hardThreshold: 40, tagOverlap: 15, characteristicMatch: 0, withinSOL: 10, feeShifting: 10, economicSignal: 5 },
    reasoning: 'Illinois Whistleblower Act scored 82/100 (primary tier). Matched tags: whistleblower, retaliation_for_reporting. Fee-shifting is available. Documentation present adds 10 bonus points.',
  },
  {
    statuteName: 'Illinois Human Rights Act',
    citation: '775 ILCS 5',
    finalScore: 78,
    tier: 'primary' as const,
    scoreBreakdown: { hardThreshold: 40, tagOverlap: 8, characteristicMatch: 15, withinSOL: 10, feeShifting: 10, economicSignal: 5 },
    reasoning: 'Illinois Human Rights Act scored 78/100 (primary tier). Matched tags: discrimination, retaliation. Protected characteristic match: race. Employer size of 200 meets the 1+ threshold.',
  },
  {
    statuteName: "Workers' Comp Act (Retaliation)",
    citation: '820 ILCS 305/4(h)',
    finalScore: 72,
    tier: 'primary' as const,
    scoreBreakdown: { hardThreshold: 40, tagOverlap: 12, characteristicMatch: 0, withinSOL: 10, feeShifting: 0, economicSignal: 5 },
    reasoning: "Workers' Comp Act scored 72/100 (primary tier). Matched tags: workers_comp_retaliation. Documentation present adds 10 bonus points.",
  },
  {
    statuteName: 'Illinois OSHA',
    citation: '820 ILCS 219',
    finalScore: 58,
    tier: 'secondary' as const,
    scoreBreakdown: { hardThreshold: 40, tagOverlap: 8, characteristicMatch: 0, withinSOL: 10, feeShifting: 0, economicSignal: 0 },
    reasoning: 'Illinois OSHA scored 58/100 (secondary tier). Matched tags: safety_complaint. Within SOL (180 days).',
  },
  {
    statuteName: 'Illinois Minimum Wage Law',
    citation: '820 ILCS 105',
    finalScore: 0,
    tier: 'excluded' as const,
    scoreBreakdown: { hardThreshold: 0, tagOverlap: 0, characteristicMatch: 0, withinSOL: 0, feeShifting: 0, economicSignal: 0 },
    reasoning: 'Excluded: No situation tag overlap with this statute.',
  },
  {
    statuteName: 'Chicago Fair Workweek Ordinance',
    citation: 'Chicago Municipal Code 1-25',
    finalScore: 0,
    tier: 'excluded' as const,
    scoreBreakdown: { hardThreshold: 0, tagOverlap: 0, characteristicMatch: 0, withinSOL: 0, feeShifting: 0, economicSignal: 0 },
    reasoning: 'Excluded: Employer size (200) passes but no situation tag overlap. This statute covers schedule changes and clopenings.',
  },
];

export default function TransparencyLogPage({ params }: { params: Promise<{ sessionId: string }> }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm text-gray-400">Transparency Log</p>
          <h1 className="text-xl font-bold">TRG-20260312-001</h1>
          <p className="text-sm text-gray-400 mt-1">Full scoring breakdown for every statute evaluated</p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <TransparencyLog entries={MOCK_LOG} />
      </main>
    </div>
  );
}
