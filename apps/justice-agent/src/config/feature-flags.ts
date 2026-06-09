/**
 * Feature flags for the Justice Agent.
 *
 * ─── DEPRECATED: Autonomous-batch pipeline (2026-06-09) ──────────────────────
 * The autonomous-batch development pipeline — where Justice spawned Claude Code
 * subprocesses to autonomously work beads on iOS/hlstc projects — plus the daily
 * "stuck task" iMessage pings, is DISABLED BY DEFAULT. This workflow was
 * superseded by Claude Code remote work and is no longer used to develop the
 * holistic app.
 *
 * The code is intentionally retained (not deleted) so the pipeline can be
 * revisited or built upon later. To re-enable the entire pipeline — batch
 * start/resume/overnight runs, single-bead autonomous runs, Claude Code
 * subprocess spawning, startup batch recovery, stuck-task detection, and the
 * `unstick_task` tool — set the env var:
 *
 *     JUSTICE_AUTONOMOUS_BATCH_ENABLED=true
 *
 * When unset (the default), all of the above is inert and Justice runs purely
 * as a reactive executive/voice agent.
 */
export function isAutonomousBatchEnabled(): boolean {
  return process.env.JUSTICE_AUTONOMOUS_BATCH_ENABLED === 'true';
}

/** User-facing reply returned by gated tool handlers when the pipeline is off. */
export const BATCH_DISABLED_MESSAGE =
  'Autonomous batch execution is deprecated and currently disabled. ' +
  'Set JUSTICE_AUTONOMOUS_BATCH_ENABLED=true to re-enable the pipeline.';
