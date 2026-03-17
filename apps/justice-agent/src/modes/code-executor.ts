/**
 * Code Executor — Mode 3 autonomous code execution with approval gates.
 *
 * Spawns Claude Code CLI in phases, logs progress to Notion,
 * and requires Isaiah's explicit approval via iMessage + Redis.
 */

import { spawn } from 'child_process';
import { sendIMessage } from '@justice/messaging';
import { notionLogger, type WorkPhase } from '../integrations/notion-logger';
import { getRedis } from '../integrations/redis-client';

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
  await notionLogger.logPhaseStart(session.notionPageId, phase);

  return new Promise((resolve) => {
    const chunks: string[] = [];
    const cwd = phase.workingDir ?? process.cwd();

    const child = spawn('claude', ['--dangerously-skip-permissions', '--print', phase.prompt], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

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
      const exitCode = code ?? 1;
      const output = chunks.join('');
      const durationMs = Date.now() - start;
      const duration = `${(durationMs / 1000).toFixed(1)}s`;

      await notionLogger.logPhaseComplete(session.notionPageId, phase, output, exitCode);

      const statusEmoji = exitCode === 0 ? 'Done' : 'Failed';
      const approvedNumber = process.env.APPROVED_NUMBER_ISAIAH;
      if (approvedNumber) {
        await sendIMessage(
          approvedNumber,
          `Phase ${phase.number} ${statusEmoji}: ${phase.name} (${duration})\nNotion: ${notionLogger.pageUrl(session.notionPageId)}\nReply YES to continue or NO to stop.`
        );
      }

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
 * Sets a pending key, pings Isaiah, then polls every 5s.
 * Resolves true (YES) or false (NO). Rejects on timeout (default 24h).
 */
export async function waitForApproval(
  session: TaskSession,
  question: string,
  timeoutMs = 24 * 60 * 60 * 1000
): Promise<boolean> {
  const key = `justice:approval:${session.sessionId}`;
  const redis = getRedis();

  await redis.set(key, 'PENDING');
  await notionLogger.logQuestion(session.notionPageId, question);

  const approvedNumber = process.env.APPROVED_NUMBER_ISAIAH;
  if (approvedNumber) {
    await sendIMessage(approvedNumber, `Justice needs approval: ${question}\nReply YES or NO.`);
  }

  return new Promise((resolve, reject) => {
    const poll = setInterval(async () => {
      try {
        const val = await redis.get(key);
        if (val === 'YES') {
          clearInterval(poll);
          clearTimeout(timeout);
          await redis.del(key);
          resolve(true);
        } else if (val === 'NO') {
          clearInterval(poll);
          clearTimeout(timeout);
          await redis.del(key);
          resolve(false);
        }
      } catch {
        // Redis read error — keep polling
      }
    }, 5000);

    const timeout = setTimeout(async () => {
      clearInterval(poll);
      await redis.del(key);
      reject(new Error(`Approval timeout after ${timeoutMs}ms for session ${session.sessionId}`));
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
