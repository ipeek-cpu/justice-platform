import { ScoringBreakdown } from '@/components/ScoringBreakdown';
import { CaseLawReference } from '@/components/CaseLawReference';
import { EconomicViabilityScore } from '@/components/EconomicViabilityScore';
import { DisclaimerFooter } from '@/components/DisclaimerFooter';

// TODO: Replace with real data fetched by sessionId
const MOCK_CASE = {
  sessionId: 'TRG-20260312-001',
  dealSummary: 'Caller reports workplace retaliation after filing an internal complaint about safety violations at a large manufacturing employer in Cook County. The incident occurred within the past month. Caller indicates they have documentation supporting their account. Initial assessment identified 3 primary statutory matches for attorney review.',
  primaryStatutes: [
    { name: 'Illinois Whistleblower Act', citation: '740 ILCS 174', score: 82, matchReasons: ['Matched tags: whistleblower, retaliation_for_reporting', 'Fee-shifting available', 'Within statute of limitations (365 days)'] },
    { name: 'Illinois Human Rights Act', citation: '775 ILCS 5', score: 78, matchReasons: ['Matched tags: retaliation', 'Protected characteristic match: race', 'Fee-shifting available'] },
    { name: "Workers' Comp Act (Retaliation)", citation: '820 ILCS 305/4(h)', score: 72, matchReasons: ['Matched tags: workers_comp_retaliation', 'Within statute of limitations'] },
  ],
  secondaryStatutes: [
    { name: 'Illinois OSHA', citation: '820 ILCS 219', score: 58, matchReasons: ['Matched tags: safety_complaint', 'Within statute of limitations'] },
  ],
  caseLaw: [
    { caseName: 'Burlington Northern v. White', citation: '548 U.S. 53 (2006)', year: 2006, court: 'U.S. Supreme Court', holding: 'Anti-retaliation provision not limited to actions affecting terms and conditions of employment.' },
    { caseName: 'Lawson v. FMR LLC', citation: '571 U.S. 429 (2014)', year: 2014, court: 'U.S. Supreme Court', holding: 'SOX whistleblower protections extend to employees of privately held contractors.' },
    { caseName: 'McDonnell Douglas v. Green', citation: '411 U.S. 792 (1973)', year: 1973, court: 'U.S. Supreme Court', holding: 'Established burden-shifting framework for employment discrimination cases.' },
  ],
  economicViability: { score: 85, label: 'Strong', w2RangeStr: '75k_100k', feeShiftingAvailable: true, documentationPresent: true, contingencyViable: true },
  estimatedDamagesRange: '$30,000 - $250,000 (rough estimate)',
  arguingPoints: [
    'Caller has documentation supporting their account, reducing discovery burden.',
    'Recent incident — evidence and witness recollection are fresh.',
    'Fee-shifting available under Illinois Whistleblower Act, Illinois Human Rights Act.',
    'Multiple strong statutory bases (3 primary matches) — strengthens negotiating position.',
    'Large employer — more likely to have documented policies and resources for settlement.',
  ],
  riskFlags: [
    { text: 'Statute of limitations approaching for Illinois OSHA (180 days). Prompt action recommended.', severity: 'high' },
  ],
  agencyOptions: [
    { agencyName: 'OSHA', claimType: 'Safety complaint / whistleblower retaliation', deadline: '30 days from retaliatory action', callerCanSelfFile: true },
    { agencyName: 'IDHR', claimType: 'Discrimination charge', deadline: '300 days from discriminatory act', callerCanSelfFile: true },
  ],
};

export default function CaseDetailPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const c = MOCK_CASE;

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <p className="text-sm text-gray-400 mb-1">Case Package</p>
          <h1 className="text-xl font-bold">{c.sessionId}</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* Section 1: Deal Summary */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-3">Deal Summary</h2>
          <p className="text-gray-300 leading-relaxed">{c.dealSummary}</p>
        </section>

        {/* Section 2: Applicable Statutes */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Applicable Statutes</h2>
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-green-400 uppercase tracking-wide">Primary (Score 70+)</h3>
            {c.primaryStatutes.map(s => (
              <ScoringBreakdown key={s.citation} statute={s} tier="primary" />
            ))}
            <h3 className="text-sm font-medium text-yellow-400 uppercase tracking-wide mt-6">Secondary (Score 40-69)</h3>
            {c.secondaryStatutes.map(s => (
              <ScoringBreakdown key={s.citation} statute={s} tier="secondary" />
            ))}
          </div>
        </section>

        {/* Section 3: Case Law */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Case Law References</h2>
          <div className="space-y-3">
            {c.caseLaw.map(cl => (
              <CaseLawReference key={cl.citation} {...cl} />
            ))}
          </div>
        </section>

        {/* Section 4: Economic Viability */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Economic Thesis</h2>
          <EconomicViabilityScore
            score={c.economicViability.score}
            label={c.economicViability.label}
            w2Range={c.economicViability.w2RangeStr}
            feeShifting={c.economicViability.feeShiftingAvailable}
            documentation={c.economicViability.documentationPresent}
            estimatedDamages={c.estimatedDamagesRange}
          />
        </section>

        {/* Section 5: Arguing Points */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-3 text-green-400">Arguing Points</h2>
          <ul className="space-y-2">
            {c.arguingPoints.map((p, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-green-400 mt-1 shrink-0">+</span>
                <span className="text-gray-300">{p}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Section 6: Risk Flags */}
        <section className="bg-gray-900 border border-amber-700/50 rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-3 text-amber-400">Risk Flags</h2>
          <ul className="space-y-2">
            {c.riskFlags.map((f, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-amber-400 mt-1 shrink-0">!</span>
                <span className="text-gray-300">{f.text}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Section 7: Agency Options */}
        {c.agencyOptions.length > 0 && (
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-3">Agency Filing Options</h2>
            <div className="space-y-3">
              {c.agencyOptions.map((a, i) => (
                <div key={i} className="border border-gray-700 rounded-lg p-4">
                  <p className="font-medium">{a.agencyName}</p>
                  <p className="text-sm text-gray-400">{a.claimType}</p>
                  <p className="text-sm text-gray-400">Deadline: {a.deadline}</p>
                  <p className="text-sm text-gray-400">
                    {a.callerCanSelfFile ? 'Caller can self-file' : 'Attorney filing recommended'}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Section 8: Actions */}
        <section className="flex flex-col sm:flex-row gap-3">
          <button className="flex-1 bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-medium transition-colors">
            Accept Case
          </button>
          <button className="flex-1 bg-gray-700 hover:bg-gray-600 text-white px-6 py-3 rounded-lg font-medium transition-colors">
            Refer to Specialist
          </button>
          <button className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 px-6 py-3 rounded-lg font-medium transition-colors border border-gray-700">
            Decline
          </button>
        </section>
      </main>

      <DisclaimerFooter />
    </div>
  );
}
