/**
 * One-off cleanup: find (and optionally delete) calendar events that Justice
 * created with a wrong/far-future date — e.g. the unrequested April 2027 events.
 *
 * Runs against the SAME Google account(s) the agent writes to (its stored OAuth
 * tokens), so it sees exactly what Justice created.
 *
 * Usage (from repo root, with agent secrets):
 *   # 1) LIST — review what's out there (default: from today to 2028-01-01):
 *   doppler run -- tsx apps/justice-agent/src/scripts/cleanup-stray-calendar-events.ts
 *
 *   # 2) Narrow the window if you like:
 *   doppler run -- tsx .../cleanup-stray-calendar-events.ts --from 2027-01-01 --to 2027-12-31
 *
 *   # 3) DELETE specific events AFTER you've reviewed the list:
 *   doppler run -- tsx .../cleanup-stray-calendar-events.ts --delete <eventId>,<eventId>
 *
 * Flags:
 *   --identity <id>   caller identity whose tokens to use (default: isaiah)
 *   --from <ISO date> window start (default: now)
 *   --to   <ISO date> window end   (default: 2028-01-01)
 *   --delete <ids>    comma-separated event IDs to delete (no deletion without this)
 */

import { getCalendarEvents, deleteCalendarEvent } from '../integrations/google-workspace';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const identity = arg('identity') ?? 'isaiah';
  const from = arg('from') ?? new Date().toISOString();
  const to = arg('to') ?? '2028-01-01T00:00:00.000Z';
  const deleteIds = (arg('delete') ?? '').split(',').map(s => s.trim()).filter(Boolean);

  // The "normal" scheduling horizon — events beyond this are suspicious.
  const maxDaysOut = parseInt(process.env.JUSTICE_CALENDAR_MAX_DAYS_OUT ?? '', 10) || 120;
  const suspiciousAfter = Date.now() + maxDaysOut * 86_400_000;

  if (deleteIds.length > 0) {
    console.log(`Deleting ${deleteIds.length} event(s) for "${identity}"...\n`);
    for (const id of deleteIds) {
      const res = await deleteCalendarEvent(identity, id);
      if ('error' in res) console.log(`  ✗ ${id} — ${res.error}`);
      else console.log(`  ✓ ${id} — deleted from ${res.account}`);
    }
    return;
  }

  console.log(`Listing events for "${identity}" from ${from} to ${to}\n`);
  const result = await getCalendarEvents(identity, from, to);
  if ('error' in result) {
    console.error('Failed to list events:', result.error);
    process.exit(1);
  }
  if (result.events.length === 0) {
    console.log('No events in this window.');
    return;
  }

  for (const e of result.events) {
    const startMs = new Date(e.start).getTime();
    const flag = Number.isFinite(startMs) && startMs > suspiciousAfter ? '  ⚠️ FAR-FUTURE' : '';
    console.log(`${e.start}  ${e.summary}${flag}`);
    console.log(`    id=${e.id}  account=${e.account}`);
  }

  const suspicious = result.events.filter(e => new Date(e.start).getTime() > suspiciousAfter);
  console.log(`\n${result.events.length} event(s); ${suspicious.length} beyond the ${maxDaysOut}-day window.`);
  if (suspicious.length > 0) {
    console.log('\nTo delete the far-future ones after reviewing, re-run with:');
    console.log(`  --delete ${suspicious.map(e => e.id).join(',')}`);
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
