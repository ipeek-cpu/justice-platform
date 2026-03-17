import type { Statute } from '@justice/knowledge-base';
import type { TriageContext, ScoredStatute } from '@justice/shared-types';

export function matchStatutes(
  statutes: Statute[],
  context: TriageContext
): ScoredStatute[] {
  return statutes
    .filter(s => passesHardFilters(s, context))
    .map(s => {
      const score = scoreStatute(s, context);
      return {
        id: s.id,
        name: s.name,
        citation: s.citation,
        category: s.category,
        score,
        tier: score >= 70 ? 'primary' as const : score >= 40 ? 'secondary' as const : 'possible' as const,
        matchReasons: getMatchReasons(s, context),
        feeShifting: s.feeShifting,
        solDays: s.solDays,
        agencyFiling: s.agencyFiling,
        docBonus: s.docBonus,
      };
    })
    .filter(s => s.score >= 20)
    .sort((a, b) => b.score - a.score);
}

function passesHardFilters(statute: Statute, context: TriageContext): boolean {
  if (context.employerSize < statute.employerSizeMin) return false;
  if (!statute.employerTypes.includes('any') && !statute.employerTypes.includes(context.employerType)) return false;
  if (!statute.geographies.some(g => context.geography.includes(g))) return false;
  if (!statute.workerTypes.includes('any') && !statute.workerTypes.includes(context.workerType)) return false;
  return true;
}

function scoreStatute(statute: Statute, context: TriageContext): number {
  const hardThreshold = 40;
  const tagOverlap = computeTagOverlap(statute.triggerTags, context.situationTags) * 20;
  const characteristicMatch = hasCharacteristicMatch(statute, context) ? 15 : 0;
  const withinSOL = isWithinSOL(statute, context) ? 10 : 0;
  const feeShifting = statute.feeShifting ? 10 : 0;
  const economicSignal = getW2Score(context.w2RangeStr) >= 20 ? 5 : 0;
  const docBonus = context.documentationPresent ? statute.docBonus : 0;
  return hardThreshold + tagOverlap + characteristicMatch + withinSOL + feeShifting + economicSignal + docBonus;
}

function computeTagOverlap(statuteTags: string[], contextTags: string[]): number {
  if (statuteTags.length === 0) return 0;
  const matches = statuteTags.filter(t => contextTags.includes(t)).length;
  return Math.min(matches / statuteTags.length, 1);
}

function hasCharacteristicMatch(statute: Statute, context: TriageContext): boolean {
  if (!statute.protectedCharacteristics || statute.protectedCharacteristics.length === 0) return false;
  return statute.protectedCharacteristics.some(pc => context.protectedCharacteristics.includes(pc));
}

function isWithinSOL(statute: Statute, context: TriageContext): boolean {
  return context.timelineDaysAgo <= statute.solDays;
}

export function getW2Score(w2RangeStr: string): number {
  const ranges: Record<string, number> = {
    'under_30k': 5, '30k_50k': 10, '50k_75k': 15, '75k_100k': 20,
    '100k_150k': 25, 'over_150k': 30, 'unknown': 10,
  };
  return ranges[w2RangeStr] ?? 10;
}

function getMatchReasons(statute: Statute, context: TriageContext): string[] {
  const reasons: string[] = [];
  const matchedTags = statute.triggerTags.filter(t => context.situationTags.includes(t));
  if (matchedTags.length > 0) reasons.push(`Matched situation tags: ${matchedTags.join(', ')}`);
  if (hasCharacteristicMatch(statute, context)) {
    const matched = statute.protectedCharacteristics!.filter(pc => context.protectedCharacteristics.includes(pc));
    reasons.push(`Protected characteristic match: ${matched.join(', ')}`);
  }
  if (statute.feeShifting) reasons.push('Fee-shifting available — improves contingency viability');
  if (isWithinSOL(statute, context)) reasons.push(`Within statute of limitations (${statute.solDays} days)`);
  if (context.documentationPresent && statute.docBonus > 0) reasons.push(`Documentation bonus: +${statute.docBonus} points`);
  return reasons;
}
