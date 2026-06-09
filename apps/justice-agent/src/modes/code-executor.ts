/**
 * Code Executor — Mode 3 autonomous code execution with approval gates.
 *
 * Spawns Claude Code CLI in phases, logs progress to Notion,
 * and requires Isaiah's explicit approval via iMessage + Redis.
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { sendIMessage } from '@justice/messaging';
import { atomicClaim, renewClaim, cleanupTask } from '@justice/shared-types';
import { notionLogger, type WorkPhase } from '../integrations/notion-logger';
import { createApproval, getApproval, formatStamp } from '../integrations/approval-gate';
import { executionLogger } from '../integrations/execution-logger';
import { isAutonomousBatchEnabled } from '../config/feature-flags';

const execAsync = promisify(exec);

export interface PhaseResult {
  phaseId: string;
  success: boolean;
  output: string;
  duration: string;
  exitCode: number;
}

export interface TaskSession {
  sessionId: string;
  taskName: string;
  notionPageId: string;
  beadId: string;
  startedAt: Date;
  phases: WorkPhase[];
}

export interface RunPhaseOptions {
  /** Skip atomicClaim check — caller already owns the lock. */
  skipClaim?: boolean;
  /** Skip cleanupTask at end — caller will handle cleanup. */
  skipCleanup?: boolean;
  /** Suppress per-phase iMessage + approval stamp (overnight/batch mode). */
  silent?: boolean;
}

/**
 * Run a single phase by spawning Claude Code CLI.
 * Streams output, flushes to Notion periodically, logs final result.
 */
export async function runPhase(session: TaskSession, phase: WorkPhase, opts?: RunPhaseOptions): Promise<PhaseResult> {
  const start = Date.now();

  // DEPRECATED (2026-06-09): hard safety net. The autonomous-batch pipeline is
  // off by default, so no Claude Code subprocess may be spawned regardless of
  // which entry point called us. Re-enable via JUSTICE_AUTONOMOUS_BATCH_ENABLED.
  if (!isAutonomousBatchEnabled()) {
    console.warn('[code-executor] Autonomous batch disabled — refusing to spawn subprocess for', session.beadId);
    return { phaseId: phase.id, success: false, output: 'Autonomous batch execution is deprecated and disabled.', duration: '0m', exitCode: 1 };
  }

  // Only check claim on first phase — session already owns it after that
  if (phase.number === 1 && !opts?.skipClaim) {
    const claimed = await atomicClaim(session.beadId, session.sessionId);
    if (!claimed) {
      const approvedNumber = process.env.APPROVED_NUMBER_ISAIAH;
      if (approvedNumber) {
        await sendIMessage(approvedNumber,
          `Task ${session.beadId} is already running in another session. Skipping.`
        );
      }
      return { phaseId: phase.id, success: false, output: 'Already claimed', duration: '0m', exitCode: 1 };
    }
  }

  // Mark the bead as in_progress in beads so it's visible in `bd list`
  await execAsync(`${process.env.HOME}/.local/bin/bd update ${session.beadId} --status in_progress`).catch(() => {});

  await notionLogger.logPhaseStart(session.notionPageId, phase);
  executionLogger.log({ event: 'phase_started', beadId: session.beadId, project: session.taskName, sessionId: session.sessionId, phase: phase.number, phaseName: phase.name });
  await notionLogger.logTimelineEvent(session.notionPageId, 'running', `Phase ${phase.number} started: ${phase.name}`);

  return new Promise((resolve) => {
    const chunks: string[] = [];
    const cwd = phase.workingDir ?? process.cwd();

    // Strip ANTHROPIC_API_KEY so Claude Code uses the local subscription auth
    // instead of the API key (which causes 529 rate-limit errors).
    // Strip CLAUDECODE + CLAUDE_CODE_ENTRYPOINT so the subprocess doesn't think
    // it's already inside a Claude Code session (causes initialization hang).
    const { ANTHROPIC_API_KEY: _k, CLAUDECODE: _c, CLAUDE_CODE_ENTRYPOINT: _e, ...cleanEnv } = process.env;
    const child = spawn('claude', ['--dangerously-skip-permissions', '--print', phase.prompt], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: cleanEnv,
    });

    executionLogger.log({ event: 'subprocess_spawned', beadId: session.beadId, pid: child.pid, phase: phase.number });

    // Renew task checkout TTL every 15 minutes
    const renewInterval = setInterval(() => {
      renewClaim(session.beadId, session.sessionId).catch(console.error);
    }, 15 * 60 * 1000);

    // Dynamic stale timeout: 120min for review (phase 99), 90min for normal phases
    const staleTimeoutMs = phase.number === 99 ? 120 * 60 * 1000 : 90 * 60 * 1000;

    // Kill subprocess if no output received for staleTimeoutMs (stale process)
    let staleTimer = setTimeout(() => {
      child.kill('SIGTERM');
      executionLogger.log({ event: 'subprocess_timeout', beadId: session.beadId, pid: child.pid, phase: phase.number, level: 'warn' });
    }, staleTimeoutMs);

    const resetStaleTimer = () => {
      clearTimeout(staleTimer);
      staleTimer = setTimeout(() => {
        child.kill('SIGTERM');
        executionLogger.log({ event: 'subprocess_timeout', beadId: session.beadId, pid: child.pid, phase: phase.number, level: 'warn' });
      }, staleTimeoutMs);
    };

    // Flush partial output to Notion every 15 seconds
    const flushInterval = setInterval(async () => {
      if (chunks.length > 0) {
        const partial = chunks.join('').slice(-2000);
        await notionLogger.logPhaseComplete(session.notionPageId, phase, `[in progress]\n${partial}`, -1);
      }
    }, 15_000);

    // Progress heartbeat: Notion every 10min, iMessage every 30min (skip in silent mode)
    const heartbeatInterval = setInterval(async () => {
      const elapsed = Math.round((Date.now() - start) / 60000);
      const lines = chunks.join('').split('\n').length;
      await notionLogger.logTimelineEvent(
        session.notionPageId, 'running',
        `Phase ${phase.number} running — ${elapsed}min, ${lines} output lines`
      ).catch(() => {});
      if (!opts?.silent && elapsed > 0 && elapsed % 30 === 0) {
        const approvedNumber = process.env.APPROVED_NUMBER_ISAIAH;
        if (approvedNumber) {
          await sendIMessage(approvedNumber,
            `${session.taskName} still working (${elapsed}min). Not stuck.`
          ).catch(() => {});
        }
      }
    }, 10 * 60 * 1000);

    child.stdout?.on('data', (data: Buffer) => {
      chunks.push(data.toString());
      resetStaleTimer();
    });

    child.stderr?.on('data', (data: Buffer) => {
      chunks.push(data.toString());
      resetStaleTimer();
    });

    child.on('close', async (code) => {
      clearInterval(flushInterval);
      clearInterval(renewInterval);
      clearTimeout(staleTimer);
      clearInterval(heartbeatInterval);
      const exitCode = code ?? 1;
      const output = chunks.join('');
      const durationMs = Date.now() - start;
      const duration = `${(durationMs / 1000).toFixed(1)}s`;

      // Exit 143 = SIGTERM (killed by timeout). Check for partial work.
      if (exitCode === 143) {
        const elapsed = `${(durationMs / 60000).toFixed(1)}m`;
        const partialSuccess = output.length > 500;
        await notionLogger.logPhaseComplete(session.notionPageId, phase, output, exitCode);
        executionLogger.log({ event: 'phase_complete', beadId: session.beadId, sessionId: session.sessionId, phase: phase.number, success: partialSuccess, durationMs, exitCode: 143 });
        await notionLogger.logTimelineEvent(session.notionPageId, partialSuccess ? 'success' : 'failed', `Phase ${phase.number} SIGTERM after ${elapsed} (partial: ${partialSuccess})`);
        if (!opts?.skipCleanup) await cleanupTask(session.beadId, session.sessionId);
        resolve({ phaseId: phase.id, success: partialSuccess, output, duration: elapsed, exitCode: 143 });
        return;
      }

      await notionLogger.logPhaseComplete(session.notionPageId, phase, output, exitCode);
      executionLogger.log({ event: 'phase_complete', beadId: session.beadId, sessionId: session.sessionId, phase: phase.number, success: exitCode === 0, durationMs });
      await notionLogger.logTimelineEvent(session.notionPageId, exitCode === 0 ? 'success' : 'failed', `Phase ${phase.number} ${exitCode === 0 ? 'complete' : 'failed'} (${duration})`);

      if (!opts?.silent) {
        const statusEmoji = exitCode === 0 ? 'Done' : 'Failed';
        const approvedNumber = process.env.APPROVED_NUMBER_ISAIAH;
        if (approvedNumber) {
          const stamp = await createApproval(session.sessionId, `Phase ${phase.number} ${statusEmoji}: ${phase.name}`);
          await sendIMessage(
            approvedNumber,
            `Phase ${phase.number} ${statusEmoji}: ${phase.name} (${duration}) ${formatStamp(stamp)}\nNotion: ${notionLogger.pageUrl(session.notionPageId)}\nReply "yes ${stamp}" to continue or "no ${stamp}" to stop.`
          );
          await notionLogger.logTimelineEvent(session.notionPageId, 'waiting', `Waiting for approval ${formatStamp(stamp)}`);
        }
      }

      if (!opts?.skipCleanup) {
        await cleanupTask(session.beadId, session.sessionId);
      }

      resolve({
        phaseId: phase.id,
        success: exitCode === 0,
        output,
        duration,
        exitCode,
      });
    });
  });
}

/**
 * Wait for Isaiah's approval via Redis polling.
 * Creates a stamped approval, pings Isaiah, then polls every 5s.
 * Never throws — re-pings every 6 hours until resolved.
 */
export async function waitForApproval(
  session: TaskSession,
  question: string,
  options?: { onReping?: () => Promise<void> },
): Promise<boolean> {
  const stamp = await createApproval(session.sessionId, question);
  await notionLogger.logQuestion(session.notionPageId, `${formatStamp(stamp)} ${question}`);

  const approvedNumber = process.env.APPROVED_NUMBER_ISAIAH;
  if (approvedNumber) {
    await sendIMessage(approvedNumber, `Justice needs approval: ${question} ${formatStamp(stamp)}\nReply "yes ${stamp}" or "no ${stamp}".`);
  }

  return new Promise((resolve) => {
    let lastPing = Date.now();
    const REPING_MS = 6 * 60 * 60 * 1000;

    const poll = setInterval(async () => {
      try {
        const approval = await getApproval(stamp);
        if (!approval) {
          clearInterval(poll);
          resolve(false);
          return;
        }
        if (approval.status === 'YES') {
          clearInterval(poll);
          executionLogger.log({ event: 'approval_received', beadId: session.beadId, sessionId: session.sessionId, approved: true });
          resolve(true);
        } else if (approval.status === 'NO') {
          clearInterval(poll);
          executionLogger.log({ event: 'approval_received', beadId: session.beadId, sessionId: session.sessionId, approved: false });
          resolve(false);
        } else if (Date.now() - lastPing > REPING_MS) {
          if (approvedNumber) {
            await sendIMessage(approvedNumber,
              `Reminder: ${question} ${formatStamp(stamp)}\nReply "yes ${stamp}" or "no ${stamp}".`
            );
          }
          lastPing = Date.now();
          if (options?.onReping) {
            await options.onReping().catch(() => {});
          }
        }
      } catch { /* Redis error — keep polling */ }
    }, 5000);
  });
}

/**
 * Request approval for a git push. Logs PR draft to Notion first.
 */
export async function requestGitPush(
  session: TaskSession,
  branch: string,
  prDraft: { beadIds: string[]; phases: number; testCoverage: string }
): Promise<boolean> {
  await notionLogger.logPRDraft(session.notionPageId, { branch, ...prDraft });

  return waitForApproval(
    session,
    `Ready to push branch "${branch}" with ${prDraft.phases} phases. Approve git push?`
  );
}
