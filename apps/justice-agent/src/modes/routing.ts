import type { CasePackage, Attorney, RoutingResult, RoutingEvent } from '@justice/shared-types';

/**
 * Attorney Routing Engine — Mode 3
 * Routes case packages to the best-fit attorneys across the ENTIRE subscribed network.
 * Cross-tenant: a case from Wolf Law can go to an attorney at any subscribed firm.
 */

// In-memory attorney store (replace with database in production)
const subscribedAttorneys: Attorney[] = [];

export async function routeCaseToNetwork(
  casePackage: CasePackage
): Promise<RoutingResult> {
  // 1. Get all active subscribed attorneys
  const attorneys = await getSubscribedAttorneys();

  // 2. Filter by practice area + geography
  const eligible = attorneys.filter(a =>
    a.practiceAreas.some(p => casePackage.primaryStatutes.some(s => s.category === p)) &&
    a.geography.some(g => casePackage.geography.includes(g)) &&
    a.status === 'active'
  );

  if (eligible.length === 0) {
    return { notified: [], status: 'no_eligible' };
  }

  // 3. Rank by: specialty match depth, acceptance rate, response time, capacity
  const ranked = rankAttorneys(eligible, casePackage);

  // 4. Notify top 3 (scarcity creates urgency)
  const notified = ranked.slice(0, 3);

  // 5. Log routing (Tier 2 — no caller PII)
  await logRoutingEvent({
    sessionId: casePackage.sessionId,
    attorneysNotified: notified.length,
    topStatute: casePackage.primaryStatutes[0]?.id ?? 'none',
    economicScore: casePackage.economicViability.score,
    timestamp: new Date().toISOString(),
  });

  return { notified, status: 'sent', routedAt: new Date().toISOString() };
}

function rankAttorneys(attorneys: Attorney[], casePackage: CasePackage): Attorney[] {
  const caseCategories = new Set(casePackage.primaryStatutes.map(s => s.category));

  return attorneys
    .map(attorney => {
      let score = 0;

      // Specialty match depth (how many practice areas overlap)
      const specialtyOverlap = attorney.practiceAreas.filter(p => caseCategories.has(p)).length;
      score += specialtyOverlap * 30;

      // Acceptance rate (higher = more likely to take case)
      score += attorney.acceptanceRate * 20;

      // Response time (faster = better caller experience)
      score += Math.max(0, 100 - attorney.avgResponseTimeMinutes) * 0.1;

      // Capacity (more room = more likely to accept)
      const capacityRatio = Math.max(0, attorney.capacity - attorney.currentCaseLoad) / Math.max(attorney.capacity, 1);
      score += capacityRatio * 20;

      // Premium subscribers get slight boost
      if (attorney.subscriptionTier === 'premium') score += 10;

      return { attorney, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(r => r.attorney);
}

async function getSubscribedAttorneys(): Promise<Attorney[]> {
  // TODO: Query from database
  return subscribedAttorneys.filter(a => a.status === 'active');
}

// Routing event log (Tier 2 — no caller PII)
const routingLog: RoutingEvent[] = [];

async function logRoutingEvent(event: RoutingEvent): Promise<void> {
  routingLog.push(event);
  if (routingLog.length > 10000) routingLog.splice(0, routingLog.length - 10000);
}

export function getRoutingLog(limit = 50): RoutingEvent[] {
  return routingLog.slice(-limit);
}

export function registerAttorney(attorney: Attorney): void {
  subscribedAttorneys.push(attorney);
}
