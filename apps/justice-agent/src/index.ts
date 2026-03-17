/**
 * Justice Agent — Entry point
 *
 * Starts the executive webhook server (Mode 1).
 * Voice agent (Mode 2) and routing engine (Mode 3) are triggered
 * via separate Twilio webhook paths and ElevenLabs integration.
 */

import { startExecutiveWebhook } from './modes/executive-webhook';
import { closeDatabaseConnection } from './db/connection';
import { closeRedis } from './integrations/redis-client';
import { runTaskNudge } from './nudge/task-nudger';
import { runMorningBrief } from './nudge/morning-brief';
import { startCronJobs } from './cron/schedule';

// Start executive assistant webhook
startExecutiveWebhook();

// Proactive task nudger — checks every 30 minutes
setInterval(runTaskNudge, 30 * 60 * 1000);
console.log('[nudge] Task nudger active, checking every 30 minutes');

// Morning brief — checks every 10 minutes, sends once per day at 8 AM CT
setInterval(runMorningBrief, 10 * 60 * 1000);
console.log('[morning-brief] Active, will deliver between 8:00-8:15 AM CT');

// Proactive cron jobs (daily checks at 8am)
startCronJobs();

// Graceful shutdown — close DB pool
const shutdown = async () => {
  await closeRedis();
  await closeDatabaseConnection();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
