const MOCK_ROUTING = [
  {
    sessionId: 'TRG-20260312-001',
    attorneysNotified: 3,
    topStatute: 'Illinois Whistleblower Act',
    economicScore: 85,
    timestamp: '2026-03-12T10:35:00Z',
    status: 'accepted',
  },
  {
    sessionId: 'TRG-20260312-002',
    attorneysNotified: 3,
    topStatute: 'Illinois Minimum Wage Law',
    economicScore: 65,
    timestamp: '2026-03-12T11:20:00Z',
    status: 'pending',
  },
];

export default function RoutingPage() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-xl font-bold">Routing History</h1>
          <p className="text-sm text-gray-400">Which cases went to which attorneys</p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="space-y-3">
          {MOCK_ROUTING.map(r => (
            <div key={r.sessionId} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="font-mono text-sm text-gray-400">{r.sessionId}</p>
                  <p className="font-medium">{r.topStatute}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm">
                    <span className="text-gray-400">Notified:</span>{' '}
                    <span className="font-mono">{r.attorneysNotified} attorneys</span>
                  </p>
                  <p className="text-sm">
                    <span className="text-gray-400">Economic:</span>{' '}
                    <span className="font-mono">{r.economicScore}/100</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{new Date(r.timestamp).toLocaleString()}</span>
                <span className={r.status === 'accepted' ? 'text-green-400' : 'text-yellow-400'}>
                  {r.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
