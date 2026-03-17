interface EconomicViabilityScoreProps {
  score: number;
  label: string;
  w2Range: string;
  feeShifting: boolean;
  documentation: boolean;
  estimatedDamages: string;
}

const w2Labels: Record<string, string> = {
  'under_30k': 'Under $30K',
  '30k_50k': '$30K - $50K',
  '50k_75k': '$50K - $75K',
  '75k_100k': '$75K - $100K',
  '100k_150k': '$100K - $150K',
  'over_150k': 'Over $150K',
  'unknown': 'Not disclosed',
};

export function EconomicViabilityScore(props: EconomicViabilityScoreProps) {
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (props.score / 100) * circumference;

  const color = props.score >= 80 ? '#22c55e' : props.score >= 60 ? '#3b82f6' : props.score >= 40 ? '#eab308' : '#ef4444';

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <div className="flex flex-col sm:flex-row items-center gap-6">
        {/* Ring chart */}
        <div className="relative w-28 h-28 shrink-0">
          <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40" fill="none" stroke="#1f2937" strokeWidth="8" />
            <circle
              cx="50" cy="50" r="40" fill="none"
              stroke={color} strokeWidth="8"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold">{props.score}</span>
            <span className="text-xs text-gray-400">{props.label}</span>
          </div>
        </div>

        {/* Breakdown table */}
        <div className="flex-1 w-full">
          <table className="w-full text-sm">
            <tbody>
              <Row label="W2 Range" value={w2Labels[props.w2Range] ?? props.w2Range} />
              <Row label="Fee-Shifting" value={props.feeShifting ? 'Available' : 'Not available'} highlight={props.feeShifting} />
              <Row label="Documentation" value={props.documentation ? 'Present' : 'Not provided'} highlight={props.documentation} />
              <Row label="Est. Damages Range" value={props.estimatedDamages} />
              <Row label="Contingency Viable" value={props.score >= 60 ? 'Yes' : 'Marginal'} highlight={props.score >= 60} />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <tr className="border-b border-gray-800 last:border-0">
      <td className="py-2 text-gray-400">{label}</td>
      <td className={`py-2 text-right ${highlight ? 'text-green-400' : 'text-gray-200'}`}>{value}</td>
    </tr>
  );
}
