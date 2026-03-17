interface ScoringBreakdownProps {
  statute: {
    name: string;
    citation: string;
    score: number;
    matchReasons: string[];
  };
  tier: 'primary' | 'secondary' | 'possible';
}

const tierColors = {
  primary: 'border-green-700/50',
  secondary: 'border-yellow-700/50',
  possible: 'border-gray-700',
};

const scoreBadgeColors = {
  primary: 'bg-green-400/10 text-green-400',
  secondary: 'bg-yellow-400/10 text-yellow-400',
  possible: 'bg-gray-400/10 text-gray-400',
};

export function ScoringBreakdown({ statute, tier }: ScoringBreakdownProps) {
  return (
    <div className={`bg-gray-900 border ${tierColors[tier]} rounded-lg p-4`}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="font-medium">{statute.name}</p>
          <p className="text-sm text-gray-400">{statute.citation}</p>
        </div>
        <span className={`text-sm px-2 py-1 rounded-md font-mono font-medium ${scoreBadgeColors[tier]}`}>
          {statute.score}/100
        </span>
      </div>
      <ul className="mt-2 space-y-1">
        {statute.matchReasons.map((r, i) => (
          <li key={i} className="text-sm text-gray-400 flex items-start gap-1.5">
            <span className="text-gray-600 mt-0.5 shrink-0">-</span>
            {r}
          </li>
        ))}
      </ul>
    </div>
  );
}
