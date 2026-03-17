import type { TransparencyEntry, ScoredStatute, TriageContext } from '@justice/shared-types';
import type { Statute } from '@justice/knowledge-base';
import { getW2Score } from '@justice/scoring-engine';

export function generateTransparencyLog(
  allStatutes: Statute[],
  matchedStatutes: ScoredStatute[],
  context: TriageContext
): TransparencyEntry[] {
  const matchedIds = new Set(matchedStatutes.map(s => s.id));

  return allStatutes.map(statute => {
    const matched = matchedStatutes.find(s => s.id === statute.id);

    if (matched) {
      return {
        statuteName: matched.name,
        citation: matched.citation,
        finalScore: matched.score,
        tier: matched.tier,
        scoreBreakdown: computeBreakdown(statute, context),
        reasoning: generateReasoning(statute, context, matched.score, matched.tier),
      };
    }

    return {
      statuteName: statute.name,
      citation: statute.citation,
      finalScore: 0,
      tier: 'excluded' as const,
      scoreBreakdown: { hardThreshold: 0, tagOverlap: 0, characteristicMatch: 0, withinSOL: 0, feeShifting: 0, economicSignal: 0 },
      reasoning: generateExclusionReason(statute, context),
    };
  });
}

function computeBreakdown(statute: Statute, context: TriageContext): TransparencyEntry['scoreBreakdown'] {
  const tagOverlapRaw = statute.triggerTags.filter(t => context.situationTags.includes(t)).length;
  const tagOverlap = Math.min(tagOverlapRaw / Math.max(statute.triggerTags.length, 1), 1) * 20;
  const characteristicMatch = statute.protectedCharacteristics?.some(pc => context.protectedCharacteristics.includes(pc)) ? 15 : 0;
  const withinSOL = context.timelineDaysAgo <= statute.solDays ? 10 : 0;
  const feeShifting = statute.feeShifting ? 10 : 0;
  const economicSignal = getW2Score(context.w2RangeStr) >= 20 ? 5 : 0;

  return { hardThreshold: 40, tagOverlap: Math.round(tagOverlap * 100) / 100, characteristicMatch, withinSOL, feeShifting, economicSignal };
}

function generateReasoning(statute: Statute, context: TriageContext, score: number, tier: string): string {
  const parts: string[] = [`${statute.name} scored ${score}/100 (${tier} tier).`];
  const matchedTags = statute.triggerTags.filter(t => context.situationTags.includes(t));
  if (matchedTags.length > 0) parts.push(`Matched tags: ${matchedTags.join(', ')}.`);
  if (statute.employerSizeMin > 0 && context.employerSize >= statute.employerSizeMin) {
    parts.push(`Employer size of ${context.employerSize} meets the ${statute.employerSizeMin}+ threshold.`);
  }
  if (statute.feeShifting) parts.push('Fee-shifting is available under this statute.');
  if (context.documentationPresent && statute.docBonus > 0) parts.push(`Documentation present adds ${statute.docBonus} bonus points.`);
  return parts.join(' ');
}

function generateExclusionReason(statute: Statute, context: TriageContext): string {
  const reasons: string[] = [];
  if (context.employerSize < statute.employerSizeMin) reasons.push(`Employer size (${context.employerSize}) below minimum (${statute.employerSizeMin}).`);
  if (!statute.employerTypes.includes('any') && !statute.employerTypes.includes(context.employerType)) reasons.push(`Employer type (${context.employerType}) not covered.`);
  if (!statute.geographies.some(g => context.geography.includes(g))) reasons.push(`Geography mismatch: statute covers ${statute.geographies.join(', ')}.`);
  if (!statute.workerTypes.includes('any') && !statute.workerTypes.includes(context.workerType)) reasons.push(`Worker type (${context.workerType}) not covered.`);
  if (reasons.length === 0) {
    const matchedTags = statute.triggerTags.filter(t => context.situationTags.includes(t));
    reasons.push(matchedTags.length === 0 ? 'No situation tag overlap.' : 'Score below minimum threshold of 20.');
  }
  return `Excluded: ${reasons.join(' ')}`;
}
