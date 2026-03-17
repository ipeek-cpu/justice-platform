'use client';

interface TransparencyEntry {
  statuteName: string;
  citation: string;
  finalScore: number;
  tier: 'primary' | 'secondary' | 'possible' | 'excluded';
  scoreBreakdown: {
    hardThreshold: number;
    tagOverlap: number;
    characteristicMatch: number;
    withinSOL: number;
    feeShifting: number;
    economicSignal: number;
  };
  reasoning: string;
}

interface TransparencyLogProps {
  entries: TransparencyEntry[];
}

const tierBorder = {
  primary: 'border-green-700/50',
  secondary: 'border-yellow-700/50',
  possible: 'border-gray-700',
  excluded: 'border-red-900/30',
};

const tierLabel = {
  primary: 'text-green-400',
  secondary: 'text-yellow-400',
  possible: 'text-gray-400',
  excluded: 'text-red-400',
};

const barColors: { key: keyof TransparencyEntry['scoreBreakdown']; color: string; label: string }[] = [
  { key: 'hardThreshold', color: '#22c55e', label: 'Hard Threshold' },
  { key: 'tagOverlap', color: '#3b82f6', label: 'Tag Overlap' },
  { key: 'characteristicMatch', color: '#a855f7', label: 'Characteristic' },
  { key: 'withinSOL', color: '#eab308', label: 'SOL' },
  { key: 'feeShifting', color: '#f97316', label: 'Fee-Shifting' },
  { key: 'economicSignal', color: '#ef4444', label: 'Economic' },
];

export function TransparencyLog({ entries }: TransparencyLogProps) {
  // Sort: primary first, then secondary, then possible, then excluded
  const tierOrder = { primary: 0, secondary: 1, possible: 2, excluded: 3 };
  const sorted = [...entries].sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier] || b.finalScore - a.finalScore);

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-6">
        {barColors.map(b => (
          <div key={b.key} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: b.color }} />
            <span className="text-xs text-gray-400">{b.label}</span>
          </div>
        ))}
      </div>

      {sorted.map(entry => {
        const maxScore = 100;
        const total = Object.values(entry.scoreBreakdown).reduce((a, b) => a + b, 0);

        return (
          <div key={entry.citation} className={`bg-gray-900 border ${tierBorder[entry.tier]} rounded-xl p-5`}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="font-medium">{entry.statuteName}</p>
                <p className="text-sm text-gray-400">{entry.citation}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-mono font-bold">{entry.finalScore}</p>
                <p className={`text-xs uppercase tracking-wide ${tierLabel[entry.tier]}`}>{entry.tier}</p>
              </div>
            </div>

            {/* Stacked horizontal bar */}
            {total > 0 && (
              <div className="flex h-5 rounded-full overflow-hidden bg-gray-800 mb-3">
                {barColors.map(b => {
                  const value = entry.scoreBreakdown[b.key];
                  if (value === 0) return null;
                  return (
                    <div
                      key={b.key}
                      style={{
                        width: `${(value / maxScore) * 100}%`,
                        backgroundColor: b.color,
                      }}
                      title={`${b.label}: ${value}`}
                    />
                  );
                })}
              </div>
            )}

            {/* Score component values */}
            {total > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mb-3">
                {barColors.map(b => {
                  const value = entry.scoreBreakdown[b.key];
                  if (value === 0) return null;
                  return (
                    <span key={b.key}>
                      {b.label}: <span className="text-gray-300">{value}</span>
                    </span>
                  );
                })}
              </div>
            )}

            {/* Plain language reasoning */}
            <p className="text-sm text-gray-400 leading-relaxed">{entry.reasoning}</p>
          </div>
        );
      })}
    </div>
  );
}
