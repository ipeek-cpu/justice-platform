import type { TriageContext, ScoredStatute, EconomicViabilityScore } from '@justice/shared-types';
import { getW2Score } from './statute-matcher';

export function scoreEconomicViability(
  context: TriageContext,
  statutes: ScoredStatute[]
): EconomicViabilityScore {
  const w2Score = getW2Score(context.w2RangeStr);
  const feeShiftingScore = statutes.some(s => s.feeShifting && s.score >= 40) ? 30 : 10;
  const docScore = context.documentationPresent ? 25 : 0;
  const timelineScore = context.timelineDaysAgo < 60 ? 15 : context.timelineDaysAgo < 180 ? 10 : 5;
  const total = Math.min(w2Score + feeShiftingScore + docScore + timelineScore, 100);

  return {
    score: total,
    w2RangeStr: context.w2RangeStr,
    feeShiftingAvailable: feeShiftingScore === 30,
    documentationPresent: context.documentationPresent,
    contingencyViable: total >= 60,
    label: total >= 80 ? 'Strong' : total >= 60 ? 'Viable' : total >= 40 ? 'Possible' : 'Weak',
  };
}
