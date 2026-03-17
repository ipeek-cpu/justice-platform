import Link from 'next/link';
import { CaseCard } from '@/components/CaseCard';
import { DisclaimerFooter } from '@/components/DisclaimerFooter';

// TODO: Replace with real data from API
const MOCK_CASES = [
  {
    sessionId: 'TRG-20260312-001',
    dealSummary: 'Caller reports workplace retaliation after filing internal complaint about safety violations at a large manufacturing employer in Cook County.',
    topStatute: 'Illinois Whistleblower Act',
    topScore: 82,
    economicLabel: 'Strong' as const,
    economicScore: 85,
    primaryCount: 3,
    secondaryCount: 2,
    createdAt: '2026-03-12T10:30:00Z',
  },
  {
    sessionId: 'TRG-20260312-002',
    dealSummary: 'Caller reports unpaid overtime and wage deductions at a mid-size restaurant group in Chicago.',
    topStatute: 'Illinois Minimum Wage Law',
    topScore: 75,
    economicLabel: 'Viable' as const,
    economicScore: 65,
    primaryCount: 2,
    secondaryCount: 3,
    createdAt: '2026-03-12T11:15:00Z',
  },
];

export default function DashboardPage() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold">Case Dashboard</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">attorney@example.com</span>
            <button className="text-sm text-gray-400 hover:text-white transition-colors">
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <MetricCard label="Cases in Queue" value="2" />
          <MetricCard label="Your Acceptance Rate" value="78%" />
          <MetricCard label="Avg Economic Score" value="72" />
          <MetricCard label="Pending Review" value="2" />
        </div>

        {/* Case Feed */}
        <h2 className="text-lg font-semibold mb-4">Cases Pending Review</h2>
        <div className="space-y-4">
          {MOCK_CASES.map(c => (
            <Link key={c.sessionId} href={`/cases/${c.sessionId}`}>
              <CaseCard {...c} />
            </Link>
          ))}
        </div>
      </main>

      <DisclaimerFooter />
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
