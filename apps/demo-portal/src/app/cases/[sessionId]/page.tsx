import Link from 'next/link';

const MOCK_CASE = {
  sessionId: 'TRG-20260312-001',
  dealSummary: 'Caller reports workplace retaliation after filing internal complaint about safety violations at a large employer in Cook County.',
  topStatute: 'Illinois Whistleblower Act',
  score: 82,
  economicScore: 85,
  label: 'Strong',
  primaryStatutes: [
    { name: 'Illinois Whistleblower Act', citation: '740 ILCS 174', score: 82 },
    { name: 'Illinois Human Rights Act', citation: '775 ILCS 5', score: 78 },
    { name: "Workers' Comp Act (Retaliation)", citation: '820 ILCS 305/4(h)', score: 72 },
  ],
  secondaryStatutes: [
    { name: 'Illinois OSHA', citation: '820 ILCS 219', score: 58 },
  ],
};

export default function CaseDetailPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const c = MOCK_CASE;

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-400">Case Detail</p>
            <h1 className="text-xl font-bold">{c.sessionId}</h1>
          </div>
          <Link
            href={`/cases/${c.sessionId}/log`}
            className="text-sm bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg transition-colors"
          >
            View Transparency Log
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-2">Deal Summary</h2>
          <p className="text-gray-300">{c.dealSummary}</p>
        </section>

        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
            <p className="text-sm text-gray-400">Top Score</p>
            <p className="text-3xl font-bold">{c.score}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
            <p className="text-sm text-gray-400">Economic</p>
            <p className="text-3xl font-bold">{c.economicScore}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
            <p className="text-sm text-gray-400">Viability</p>
            <p className="text-3xl font-bold text-green-400">{c.label}</p>
          </div>
        </div>

        <section>
          <h2 className="text-lg font-semibold mb-3">Primary Statutes</h2>
          <div className="space-y-2">
            {c.primaryStatutes.map(s => (
              <div key={s.citation} className="bg-gray-900 border border-green-700/50 rounded-lg p-4 flex justify-between items-center">
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-sm text-gray-400">{s.citation}</p>
                </div>
                <span className="font-mono text-green-400 font-bold">{s.score}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-3">Secondary Statutes</h2>
          <div className="space-y-2">
            {c.secondaryStatutes.map(s => (
              <div key={s.citation} className="bg-gray-900 border border-yellow-700/50 rounded-lg p-4 flex justify-between items-center">
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-sm text-gray-400">{s.citation}</p>
                </div>
                <span className="font-mono text-yellow-400 font-bold">{s.score}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
