interface CaseCardProps {
  sessionId: string;
  dealSummary: string;
  topStatute: string;
  topScore: number;
  economicLabel: 'Strong' | 'Viable' | 'Possible' | 'Weak';
  economicScore: number;
  primaryCount: number;
  secondaryCount: number;
  createdAt: string;
}

const labelColors = {
  Strong: 'text-green-400 bg-green-400/10',
  Viable: 'text-blue-400 bg-blue-400/10',
  Possible: 'text-yellow-400 bg-yellow-400/10',
  Weak: 'text-red-400 bg-red-400/10',
};

export function CaseCard(props: CaseCardProps) {
  const timeAgo = getTimeAgo(props.createdAt);
  const colorClass = labelColors[props.economicLabel];

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-600 transition-colors cursor-pointer">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-mono text-sm text-gray-400">{props.sessionId}</p>
          <p className="font-medium mt-1">{props.topStatute}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-sm px-2 py-1 rounded-md font-medium ${colorClass}`}>
            {props.economicLabel} ({props.economicScore})
          </span>
          <span className="text-sm text-gray-500">{timeAgo}</span>
        </div>
      </div>
      <p className="text-sm text-gray-400 line-clamp-2 mb-3">{props.dealSummary}</p>
      <div className="flex gap-4 text-xs text-gray-500">
        <span>{props.primaryCount} primary</span>
        <span>{props.secondaryCount} secondary</span>
        <span>Score: {props.topScore}/100</span>
      </div>
    </div>
  );
}

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
