import type { ScoredStatute, TriageContext } from '@justice/shared-types';
import type { ArguingPoint } from '@justice/shared-types';

export function generateArguingPoints(
  context: TriageContext,
  statutes: ScoredStatute[]
): ArguingPoint[] {
  const points: ArguingPoint[] = [];

  if (context.documentationPresent) {
    points.push({ text: 'Caller has documentation supporting their account, reducing discovery burden.', strength: 'strong' });
  }
  if (context.timelineDaysAgo < 60) {
    points.push({ text: 'Recent incident — evidence and witness recollection are fresh.', strength: 'strong' });
  } else if (context.timelineDaysAgo < 180) {
    points.push({ text: 'Incident within past 6 months — timeline reasonable for claim preparation.', strength: 'moderate' });
  }

  const feeShiftingStatutes = statutes.filter(s => s.feeShifting && s.score >= 40);
  if (feeShiftingStatutes.length > 0) {
    points.push({
      text: `Fee-shifting available under ${feeShiftingStatutes.map(s => s.name).join(', ')} — attorney fees recoverable if successful.`,
      supportingStatute: feeShiftingStatutes[0].citation,
      strength: 'strong',
    });
  }

  const primaryStatutes = statutes.filter(s => s.score >= 70);
  if (primaryStatutes.length >= 2) {
    points.push({ text: `Multiple strong statutory bases (${primaryStatutes.length} primary matches) — strengthens negotiating position.`, strength: 'strong' });
  }
  if (context.employerSize >= 100) {
    points.push({ text: 'Large employer — more likely to have documented policies and resources for settlement.', strength: 'moderate' });
  }
  if (context.protectedCharacteristics.length > 0) {
    points.push({ text: `Protected characteristic(s) identified: ${context.protectedCharacteristics.join(', ')} — statutory protections apply.`, strength: 'moderate' });
  }

  return points;
}
