/**
 * Code Executor — Mode 3 autonomous code execution with approval gates.
 *
 * Spawns Claude Code CLI in phases, logs progress to Notion,
 * and requires Isaiah's explicit approval via iMessage + Redis.
 */

import { spawn } from 'child_process';
import { sendIMessage } from '@justice/messaging';
import { atomicClaim, renewClaim, cleanupTask } from '@justice/shared-types';
import { notionLogger, type WorkPhase } from '../integrations/notion-logger';
import { createApproval, getApproval, formatStamp } from '../integrations/approval-gate';

export interface PhaseResult {
  phaseId: string;
  success: boolean;
  output: string;
  duration: string;
}

export interface TaskSession {
  sessionId: string;
  taskName: string;
  notionPageId: string;
  beadId: string;
  startedAt: Date;
  phases: WorkPhase[];
}

/**
 * Run a single phase by spawning Claude Code CLI.
 * Streams output, flushes to Notion periodically, logs final result.
 */
export async function runPhase(session: TaskSession, phase: WorkPhase): Promise<PhaseResult> {
  const start = Date.now();

  // Only check claim on first phase — session already owns it after that
  if (phase.number === 1) {
    const claimed = await atomicClaim(session.beadId, session.sessionId);
    if (!claimed) {
      const approvedNumber = process.env.APPROVED_NUMBER_ISAIAH;
      if (approvedNumber) {
        await sendIMessage(approvedNumber,
          `Task ${session.beadId} is already running in another session. Skipping.`
        );
      }
      return { phaseId: phase.id, success: false, output: 'Already claimed', duration: '0m' };
    }
  }

  await notionLogger.logPhaseStart(session.notionPageId, phase);

  return new Promise((resolve) => {
    const chunks: string[] = [];
    const cwd = phase.workingDir ?? process.cwd();

    const child = spawn('claude', ['--dangerously-skip-permissions', '--print', phase.prompt], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    // Renew task checkout TTL every 15 minutes
    const renewInterval = setInterval(() => {
      renewClaim(session.beadId, session.sessionId).catch(console.error);
    }, 15 * 60 * 1000);

    // Flush partial output to Notion every 15 seconds
    const flushInterval = setInterval(async () => {
      if (chunks.length > 0) {
        const partial = chunks.join('').slice(-2000);
        await notionLogger.logPhaseComplete(session.notionPageId, phase, `[in progress]\n${partial}`, -1);
      }
    }, 15_000);

    child.stdout?.on('data', (data: Buffer) => {
      chunks.push(data.toString());
    });

    child.stderr?.on('data', (data: Buffer) => {
      chunks.push(data.toString());
    });

    child.on('close', async (code) => {
      clearInterval(flushInterval);
      clearInterval(renewInterval);
      const exitCode = code ?? 1;
      const output = chunks.join('');
      const durationMs = Date.now() - start;
      const duration = `${(durationMs / 1000).toFixed(1)}s`;

      await notionLogger.logPhaseComplete(session.notionPageId, phase, output, exitCode);

      const statusEmoji = exitCode === 0 ? 'Done' : 'Failed';
      const approvedNumber = process.env.APPROVED_NUMBER_ISAIAH;
      if (approvedNumber) {
        const stamp = await createApproval(session.sessionId, `Phase ${phase.number} ${statusEmoji}: ${phase.name}`);
        await sendIMessage(
          approvedNumber,
          `Phase ${phase.number} ${statusEmoji}: ${phase.name} (${duration}) ${formatStamp(stamp)}\nNotion: ${notionLogger.pageUrl(session.notionPageId)}\nReply "yes ${stamp}" to continue or "no ${stamp}" to stop.`
        );
      }

      await cleanupTask(session.beadId, session.sessionId);

      resolve({
        phaseId: phase.id,
        success: exitCode === 0,
        output,
        duration,
      });
    });
  });
}

/**
 * Wait for Isaiah's approval via Redis polling.
 * Creates a stamped approval, pings Isaiah, then polls every 5s.
 * Resolves true (YES) or false (NO). Rejects on timeout (default 24h).
 */
export async function waitForApproval(
  session: TaskSession,
  question: string,
  timeoutMs = 24 * 60 * 60 * 1000
): Promise<boolean> {
  const stamp = await createApproval(session.sessionId, question);
  await notionLogger.logQuestion(session.notionPageId, `${formatStamp(stamp)} ${question}`);

  const approvedNumber = process.env.APPROVED_NUMBER_ISAIAH;
  if (approvedNumber) {
    await sendIMessage(approvedNumber, `Justice needs approval: ${question} ${formatStamp(stamp)}\nReply "yes ${stamp}" or "no ${stamp}".`);
  }

  return new Promise((resolve, reject) => {
    const poll = setInterval(async () => {
      try {
        const approval = await getApproval(stamp);
        if (!approval) {
          clearInterval(poll);
          clearTimeout(timeout);
          resolve(false);
          return;
        }
        if (approval.status === 'YES') {
          clearInterval(poll);
          clearTimeout(timeout);
          resolve(true);
        } else if (approval.status === 'NO') {
          clearInterval(poll);
          clearTimeout(timeout);
          resolve(false);
        }
      } catch {
        // Redis read error — keep polling
      }
    }, 5000);

    const timeout = setTimeout(() => {
      clearInterval(poll);
      reject(new Error(`Approval timeout after ${timeoutMs}ms for ${formatStamp(stamp)}`));
    }, timeoutMs);
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
