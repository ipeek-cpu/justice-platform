/**
 * Job Digest — daily iMessage of the top-ranked new job matches.
 *
 * Sibling to nudge/morning-brief.ts. Wired to its own cron entry (~8:30 AM CT,
 * after the 8:00 brief) in cron/schedule.ts. Reads the Notion jobs DB, ranks
 * status=new rows by fit_score, and sends Isaiah the top N with one-liners and
 * deep links into each Notion row. Sends nothing if there are no new matches.
 */

import { queryNotionDatabase } from '../integrations/notion-client';
import { notionLogger } from '../integrations/notion-logger';
import { sendGuardedIMessage } from './send-guard';

let lastDigestDate: string | null = null;

function todayStrCT(): string {
  return new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

interface DigestRow {
  id: string;
  company: string;
  role: string;
  lane: string;
  fitScore: number;
  whyItFits: string;
}

/**
 * Send the daily job digest. `force` bypasses the once-per-day guard
 * (used by the conversational engine for an on-demand digest).
 */
export async function runJobDigest(force = false): Promise<void> {
  const today = todayStrCT();
  if (lastDigestDate === today && !force) return;

  const phone = process.env.APPROVED_NUMBER_ISAIAH;
  if (!phone) {
    console.warn('[job-digest] APPROVED_NUMBER_ISAIAH not set, skipping');
    return;
  }

  const dbId = process.env.JUSTICE_JOBS_DB_ID;
  if (!dbId) {
    console.warn('[job-digest] JUSTICE_JOBS_DB_ID not set, skipping');
    return;
  }

  const topN = parseInt(process.env.JOB_DIGEST_TOP_N ?? '5', 10) || 5;

  const result = await queryNotionDatabase(dbId, {
    property: 'status',
    status: { equals: 'new' },
  });

  if ('error' in result) {
    console.error('[job-digest] Notion query failed:', result.error);
    return;
  }

  const rows: DigestRow[] = result.results
    .map((r) => ({
      id: r.id,
      company: r.properties['company'] ?? '',
      role: r.properties['role'] ?? '',
      lane: r.properties['lane'] ?? '',
      fitScore: Number(r.properties['fit_score'] ?? 0),
      whyItFits: r.properties['why_it_fits'] ?? '',
    }))
    .sort((a, b) => b.fitScore - a.fitScore)
    .slice(0, topN);

  if (rows.length === 0) {
    lastDigestDate = today;
    console.log('[job-digest] No new matches, marking as sent');
    return;
  }

  const lines = rows.map((r, i) => {
    const link = notionLogger.pageUrl(r.id);
    const why = r.whyItFits ? ` — ${r.whyItFits}` : '';
    return `${i + 1}. [${r.fitScore}] ${r.role} — ${r.company} (${r.lane})${why}\n${link}`;
  });

  const message = `Job digest — top ${rows.length} new match${rows.length === 1 ? '' : 'es'}:\n\n${lines.join('\n\n')}`;

  const send = await sendGuardedIMessage(phone, message, 'job_digest');
  if (send.sent) {
    lastDigestDate = today;
    console.log(`[job-digest] Sent for ${today} (${rows.length} matches)`);
  } else {
    console.error('[job-digest] iMessage not sent:', send.reason);
  }
}
