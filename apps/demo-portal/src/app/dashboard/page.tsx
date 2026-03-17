'use client';

import Link from 'next/link';

const MOCK_CASES = [
  { sessionId: 'TRG-20260312-001', topStatute: 'Illinois Whistleblower Act', score: 82, economicScore: 85, label: 'Strong', statutes: 5, createdAt: '2026-03-12T10:30:00Z' },
  { sessionId: 'TRG-20260312-002', topStatute: 'Illinois Minimum Wage Law', score: 75, economicScore: 65, label: 'Viable', statutes: 5, createdAt: '2026-03-12T11:15:00Z' },
];

const STATUTE_DIST = [
  { category: 'Retaliation', count: 8 },
  { category: 'Wage Theft', count: 12 },
  { category: 'Discrimination', count: 6 },
  { category: 'Whistleblower', count: 4 },
  { category: 'Privacy', count: 3 },
  { category: 'Leave', count: 2 },
];

export default function DashboardPage() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold">Justice Demo Portal</h1>
          <div className="flex gap-4">
            <Link href="/routing" className="text-sm text-gray-400 hover:text-white transition-colors">Routing</Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <MetricCard label="Total Cases" value="2" />
          <MetricCard label="Avg Score" value="78.5" />
          <MetricCard label="Avg Economic" value="75" />
          <MetricCard label="Attorneys Notified" value="6" />
        </div>

        {/* Statute Distribution */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Statute Distribution</h2>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="space-y-3">
              {STATUTE_DIST.map(d => (
                <div key={d.category} className="flex items-center gap-3">
                  <span className="text-sm text-gray-400 w-28">{d.category}</span>
                  <div className="flex-1 bg-gray-800 rounded-full h-4 overflow-hidden">
                    <div
                      className="bg-blue-500 h-full rounded-full"
                      style={{ width: `${(d.count / 12) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-mono text-gray-400 w-8 text-right">{d.count}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Case List */}
        <section>
          <h2 className="text-lg font-semibold mb-4">All Cases</h2>
          <div className="space-y-3">
            {MOCK_CASES.map(c => (
              <Link key={c.sessionId} href={`/cases/${c.sessionId}`}>
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-600 transition-colors cursor-pointer flex items-center justify-between">
                  <div>
                    <p className="font-mono text-sm text-gray-400">{c.sessionId}</p>
                    <p className="font-medium">{c.topStatute}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-mono">Score: {c.score}</span>
                    <span className="text-sm font-mono">Econ: {c.economicScore}</span>
                    <span className="text-xs bg-blue-400/10 text-blue-400 px-2 py-1 rounded">{c.label}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <p className="text-sm text-gray-400 mb-1">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}
