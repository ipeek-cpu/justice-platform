/**
 * Justice Agent — Entry point
 *
 * Starts the executive webhook server (Mode 1).
 * Voice agent (Mode 2) and routing engine (Mode 3) are triggered
 * via separate Twilio webhook paths and ElevenLabs integration.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { startExecutiveWebhook } from './modes/executive-webhook';
import { closeDatabaseConnection } from './db/connection';
import { closeRedis } from './integrations/redis-client';
import { runTaskNudge } from './nudge/task-nudger';
import { runMorningBrief } from './nudge/morning-brief';
import { startCronJobs } from './cron/schedule';
import { getActiveBatches, saveBatchState, deleteBatchState } from './modes/batch-runner';
import { cleanupStaleWorktrees } from './integrations/github';
import { listProjects } from './registry/ios-projects';
import { isAutonomousBatchEnabled } from './config/feature-flags';

const execAsync = promisify(exec);

// ─── Startup env validation ──────────────────────────────────────────────────
const REQUIRED_ENV = ['JUSTICE_PARENT_PAGE_ID', 'APPROVED_NUMBER_ISAIAH'];
const RECOMMENDED_ENV = ['JUSTICE_REGISTERED_PROJECTS'];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[startup] FATAL: Missing required env var: ${key}`);
    process.exit(1);
  }
}
for (const key of RECOMMENDED_ENV) {
  if (!process.env[key]) {
    console.warn(`[startup] Warning: Missing recommended env var: ${key}`);
  }
}

// ─── Startup cleanup ─────────────────────────────────────────────────────────
async function cleanupOnStartup(): Promise<void> {
  console.log('[startup] Running cleanup...');

  // 1. Kill orphaned Claude Code subprocesses from previous agent runs
  try {
    const { stdout } = await execAsync(
      `pgrep -f "claude.*--print" 2>/dev/null || echo ""`
    );
    const pids = stdout.trim().split('\n').filter(Boolean);
    for (const pid of pids) {
      console.log(`[startup] Killing orphaned Claude process: ${pid}`);
      try { process.kill(parseInt(pid), 'SIGTERM'); } catch {}
    }
  } catch {}

  // 2. Mark stale 'running' batches — all beads done → delete, partial → failed
  // DEPRECATED (2026-06-09): batch recovery only runs when the autonomous-batch
  // pipeline is enabled. Orphaned-process cleanup above always runs as a safety net.
  if (!isAutonomousBatchEnabled()) {
    console.log('[startup] Autonomous batch disabled — skipping batch/worktree recovery');
    console.log('[startup] Cleanup complete');
    return;
  }
  try {
    const activeBatches = await getActiveBatches();
    for (const batch of activeBatches) {
      if (batch.status === 'running') {
        const completedCount = batch.results.filter(r => r.status === 'completed').length;
        if (completedCount === batch.beadOrder.length && completedCount > 0) {
          batch.status = 'paused';
          batch.updatedAt = new Date().toISOString();
          await saveBatchState(batch);
          console.log(`[startup] Batch ${batch.batchId} — all beads done, marked paused for resume`);
        } else {
          batch.status = 'failed';
          batch.updatedAt = new Date().toISOString();
          await saveBatchState(batch);
          console.log(`[startup] Batch ${batch.batchId} — partial progress, marked failed`);
        }
      }
    }

    // 3. Clean up stale worktrees
    const activeBatchIds = (await getActiveBatches())
      .filter(b => ['queued', 'paused'].includes(b.status))
      .map(b => b.batchId);
    for (const project of listProjects()) {
      await cleanupStaleWorktrees(project, activeBatchIds).catch(err => {
        console.error(`[startup] Worktree cleanup failed for ${project.id}:`, err);
      });
    }
  } catch (err) {
    console.error('[startup] Batch/worktree cleanup error:', err);
  }

  console.log('[startup] Cleanup complete');
}

// Run cleanup then start server
cleanupOnStartup().then(() => {
  startExecutiveWebhook();
}).catch((err) => {
  console.error('[startup] Cleanup failed, starting anyway:', err);
  startExecutiveWebhook();
});

// Proactive task nudger — checks every 30 minutes
setInterval(runTaskNudge, 30 * 60 * 1000);
console.log('[nudge] Task nudger active, checking every 30 minutes');

// Morning brief — checks every 10 minutes, sends once per day at 8 AM CT
setInterval(runMorningBrief, 10 * 60 * 1000);
console.log('[morning-brief] Active, will deliver between 8:00-8:15 AM CT');

// Surface the autonomous-batch + outbound posture at startup so a misconfigured
// env (e.g. the batch pipeline accidentally left on) is obvious in the logs.
console.log(`[startup] Autonomous batch pipeline: ${isAutonomousBatchEnabled() ? 'ENABLED' : 'disabled (default)'}`);
console.log(`[startup] Outbound iMessage cap: ${process.env.JUSTICE_OUTBOUND_DAILY_MAX ?? '20'}/day` +
  `${process.env.JUSTICE_OUTBOUND_PAUSE === 'true' ? ' — PAUSED (kill-switch on)' : ''}`);

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
