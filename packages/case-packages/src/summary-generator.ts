import type { TriageContext, ScoredStatute } from '@justice/shared-types';

export function generateDealSummary(
  context: TriageContext,
  statutes: ScoredStatute[]
): string {
  const topCategory = statutes[0]?.category ?? 'employment';
  const categoryLabel = getCategoryLabel(topCategory);
  const timeframe = getTimeframeLabel(context.timelineDaysAgo);
  const employerDesc = context.employerSize >= 100 ? 'a large employer'
    : context.employerSize >= 15 ? 'a mid-size employer' : 'a small employer';

  const parts: string[] = [];
  parts.push(`Caller reports a ${categoryLabel} situation involving ${employerDesc} in ${formatGeography(context.geography)}.`);
  parts.push(`The incident occurred ${timeframe}.`);
  if (context.documentationPresent) parts.push('Caller indicates they have documentation supporting their account.');

  const primaryCount = statutes.filter(s => s.score >= 70).length;
  if (primaryCount > 0) {
    parts.push(`Initial assessment identified ${primaryCount} primary statutory match${primaryCount > 1 ? 'es' : ''} for attorney review.`);
  }

  return parts.join(' ');
}

function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    retaliation: 'workplace retaliation', wage_theft: 'wage and compensation',
    discrimination: 'employment discrimination', whistleblower: 'whistleblower protection',
    safety: 'workplace safety', leave: 'leave rights', union_activity: 'labor organizing',
    workers_comp: "workers' compensation", privacy: 'workplace privacy', contract: 'employment contract',
  };
  return labels[category] ?? 'employment';
}

function getTimeframeLabel(daysAgo: number): string {
  if (daysAgo < 7) return 'within the past week';
  if (daysAgo < 30) return 'within the past month';
  if (daysAgo < 90) return 'within the past 3 months';
  if (daysAgo < 180) return 'within the past 6 months';
  if (daysAgo < 365) return 'within the past year';
  return 'more than a year ago';
}

function formatGeography(geo: string[]): string {
  const labels: Record<string, string> = {
    illinois: 'Illinois', cook_county: 'Cook County, Illinois',
    chicago: 'Chicago, Illinois', federal: 'the United States',
  };
  return geo.map(g => labels[g] ?? g).join(' / ');
}
