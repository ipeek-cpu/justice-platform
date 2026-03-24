/**
 * Batch Runner — Executes multiple beads sequentially on one branch,
 * producing one review and one PR.
 *
 * Mirrors the overnight-runner loop but with:
 * - Topological ordering (Kahn's algorithm)
 * - Per-bead commit tracking
 * - Single batch PR with per-bead sections
 * - Redis-backed batch state
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { getRedis } from '../integrations/redis-client';
import { notionLogger } from '../integrations/notion-logger';
import { sendIMessage } from '@justice/messaging';
import { atomicClaim, cleanupTask } from '@justice/shared-types';
import { runPhase, waitForApproval, type TaskSession } from './code-executor';
import { runReviewAgent, parseReviewConcerns, createFixBeads } from './review-agent';
import { shellExec } from '../integrations/shell-exec';
import { runBuildCheck, runFinalBuildCheck } from './overnight-runner';
import { buildBatchPRDescription, createDraftPR, createBatchWorktree, cleanupBatchWorktree } from '../integrations/github';
import { executionLogger } from '../integrations/execution-logger';
import type { iOSProject } from '../registry/ios-projects';

const execAsync = promisify(exec);
const ISAIAH = process.env.APPROVED_NUMBER_ISAIAH!;
const BD = `${process.env.HOME}/.local/bin/bd`;

const BATCH_KEY_PREFIX = 'justice:batch:';
const BATCH_TTL = 7 * 86400; // 7 days — approval waits can span days

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BatchBeadResult {
  beadId: string;
  title: string;
  status: 'completed' | 'failed' | 'pending' | 'running';
  commits: string[];
  error?: string;
}

export interface BatchState {
  batchId: string;
  projectId: string;
  branch: string;
  notionPageId: string;
  sessionId: string;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'approved' | 'declined';
  beadOrder: string[];
  currentIndex: number;
  results: BatchBeadResult[];
  createdAt: string;
  updatedAt: string;
  overnight: boolean;
  prUrl?: string;
  fixCycle?: number;
  worktreePath?: string;
  label?: string;
}

// ─── Bead resolution ──────────────────────────────────────────────────────────

/** Resolve a label to all open bead IDs with that label. */
export async function getBeadsByLabel(label: string, projectPath: string): Promise<Array<{ id: string; title: string; description: string; deps?: string[] }>> {
  try {
    const { stdout } = await execAsync(
      `${BD} list --label ${label} --status open --json`,
      { cwd: projectPath }
    );
    const raw: any[] = JSON.parse(stdout);
    return raw.map(b => ({
      id: b.id,
      title: b.title ?? b.id,
      description: b.description ?? '',
      deps: (b.dependencies ?? []).map((d: any) => d.depends_on_id),
    }));
  } catch {
    return [];
  }
}

/** Topological sort via Kahn's algorithm. Beads without deps come first. */
export function resolveBatchOrder(
  beads: Array<{ id: string; deps?: string[] }>
): string[] {
  const ids = new Set(beads.map(b => b.id));
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  for (const b of beads) {
    inDegree.set(b.id, 0);
    adjList.set(b.id, []);
  }

  for (const b of beads) {
    if (b.deps) {
      for (const dep of b.deps) {
        if (ids.has(dep)) {
          adjList.get(dep)!.push(b.id);
          inDegree.set(b.id, (inDegree.get(b.id) ?? 0) + 1);
        }
      }
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const neighbor of adjList.get(current) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  // Append any beads not reachable (cycle or missing dep) at the end
  for (const b of beads) {
    if (!sorted.includes(b.id)) sorted.push(b.id);
  }

  return sorted;
}

// ─── Redis persistence ────────────────────────────────────────────────────────

export async function saveBatchState(state: BatchState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  const redis = getRedis();
  await redis.set(
    `${BATCH_KEY_PREFIX}${state.batchId}`,
    JSON.stringify(state),
    'EX',
    BATCH_TTL
  );
}

export async function getBatchState(batchId: string): Promise<BatchState | null> {
  const redis = getRedis();
  const raw = await redis.get(`${BATCH_KEY_PREFIX}${batchId}`);
  return raw ? JSON.parse(raw) : null;
}

export async function deleteBatchState(batchId: string): Promise<void> {
  const redis = getRedis();
  await redis.del(`${BATCH_KEY_PREFIX}${batchId}`);
}

export async function getActiveBatches(): Promise<BatchState[]> {
  const redis = getRedis();
  const keys = await redis.keys(`${BATCH_KEY_PREFIX}*`);
  if (keys.length === 0) return [];

  const values = await redis.mget(keys);
  return values
    .filter((v): v is string => v !== null)
    .map(v => JSON.parse(v) as BatchState)
    .filter(s => ['queued', 'running', 'paused'].includes(s.status));
}

// ─── Phase sequence helpers (env-driven, never hardcoded) ─────────────────────

function getNextPhase(project: iOSProject, currentLabel: string): string | null {
  const idx = project.phaseSequence.indexOf(currentLabel);
  if (idx === -1 || idx === project.phaseSequence.length - 1) return null;
  return project.phaseSequence[idx + 1];
}

function isFinalPhase(project: iOSProject, currentLabel: string): boolean {
  const seq = project.phaseSequence;
  return seq.length > 0 && seq[seq.length - 1] === currentLabel;
}

// ─── Main batch loop ──────────────────────────────────────────────────────────

export async function runBatchAsync(
  state: BatchState,
  project: iOSProject,
  sessionId: string
): Promise<void> {
  state.status = 'running';
  await saveBatchState(state);

  // ─── Worktree isolation ────────────────────────────────────────────────
  const fs = require('fs');
  let worktreePath = state.worktreePath;
  if (!worktreePath || !fs.existsSync(worktreePath)) {
    // Check if branch exists on origin before creating worktree
    const { stdout: branchCheck } = await execAsync(
      `git -C ${project.localPath} ls-remote --heads origin ${state.branch}`
    ).catch(() => ({ stdout: '' }));

    if (branchCheck.trim()) {
      // Branch on origin — create worktree pointing to it
      worktreePath = await createBatchWorktree(project, state.branch, state.batchId);
      state.worktreePath = worktreePath;
      await saveBatchState(state);
    } else if (!worktreePath) {
      // Fresh batch — create new worktree
      worktreePath = await createBatchWorktree(project, state.branch, state.batchId);
      state.worktreePath = worktreePath;
      await saveBatchState(state);
    } else {
      // Branch not on origin and worktree gone — unrecoverable via resume
      state.status = 'failed';
      await saveBatchState(state);
      await sendIMessage(ISAIAH,
        `Cannot resume ${state.batchId} — branch ${state.branch} not found on origin.\n` +
        `Completed beads: ${state.results.filter(r => r.status === 'completed').map(r => r.beadId).join(', ')}\n` +
        `Use ios_push_branch if commits exist locally, or start fresh.`
      );
      return;
    }
  }

  const beadMap = new Map<string, { title: string; description: string }>();
  // Prefetch bead details
  for (const beadId of state.beadOrder) {
    try {
      const { stdout } = await execAsync(
        `${BD} show ${beadId} --json`,
        { cwd: worktreePath }
      );
      const parsed = JSON.parse(stdout);
      const bead = Array.isArray(parsed) ? parsed[0] : parsed;
      beadMap.set(beadId, { title: bead.title ?? beadId, description: bead.description ?? '' });
    } catch {
      beadMap.set(beadId, { title: beadId, description: '' });
    }
  }

  // Initialize results for all beads
  state.results = state.beadOrder.map(id => ({
    beadId: id,
    title: beadMap.get(id)?.title ?? id,
    status: 'pending' as const,
    commits: [],
  }));
  await saveBatchState(state);

  for (let i = state.currentIndex; i < state.beadOrder.length; i++) {
    const beadId = state.beadOrder[i];
    const beadInfo = beadMap.get(beadId)!;
    state.currentIndex = i;
    state.results[i].status = 'running';
    await saveBatchState(state);

    // 1. Atomic claim
    const claimed = await atomicClaim(beadId, sessionId);
    if (!claimed) {
      state.results[i].status = 'failed';
      state.results[i].error = 'Already claimed by another session';
      await saveBatchState(state);
      continue;
    }

    executionLogger.log({ event: 'bead_claimed', beadId, project: project.id, sessionId });

    // 2. Log to Notion timeline
    await notionLogger.logTimelineEvent(
      state.notionPageId,
      'running',
      `[${i + 1}/${state.beadOrder.length}] Starting: ${beadInfo.title}`
    );

    // 3. Record before-commit hash
    const { stdout: beforeCommit } = await execAsync(
      `git -C ${worktreePath} rev-parse HEAD`
    );

    // 4. Build execution prompt
    const isFixCycle = (state.fixCycle ?? 0) > 0;
    const executionPrompt = [
      `Complete this task: ${beadInfo.title}`,
      '',
      beadInfo.description ? `Acceptance criteria:\n${beadInfo.description}` : '',
      '',
      isFixCycle ? 'This is an AUTO-FIX bead from a code review. Focus narrowly on the issue described above. Do not refactor or change unrelated code.' : '',
      '',
      `Project: ${project.name} at ${worktreePath}`,
      `Branch: ${state.branch}`,
      `Bead ID: ${beadId}`,
      `Batch context: bead ${i + 1} of ${state.beadOrder.length}`,
      '',
      'Write and modify files as needed. Do not run git commands — Justice handles all staging and commits.',
      '',
      'MIGRATION FILES: If you need to create a .sql migration, check existing files:',
      'ls supabase/migrations/*.sql | sort | tail -3',
      'Pick a number HIGHER than all existing files. Do NOT assume the next number.',
    ].filter(Boolean).join('\n');

    const taskSession: TaskSession = {
      sessionId,
      beadId,
      taskName: beadInfo.title,
      notionPageId: state.notionPageId,
      startedAt: new Date(),
      phases: [{ number: i + 1, id: beadId, name: beadInfo.title, prompt: executionPrompt, workingDir: worktreePath }],
    };

    try {
      // 5. Run phase (Claude Code subprocess)
      let phaseResult = await runPhase(taskSession, taskSession.phases[0], { skipClaim: true, skipCleanup: true, silent: state.overnight });

      // Retry once on SIGTERM with no meaningful output
      if (!phaseResult.success && phaseResult.exitCode === 143 && phaseResult.output.length < 500) {
        executionLogger.log({ event: 'sigterm_retry', beadId, project: project.id });
        await notionLogger.logTimelineEvent(state.notionPageId, 'running', `Retrying ${beadId} after SIGTERM timeout`);
        phaseResult = await runPhase(taskSession, taskSession.phases[0], { skipClaim: true, skipCleanup: true, silent: state.overnight });
      }

      // 6. If success: commit changes
      if (phaseResult.success) {
        const { stdout: statusOutput } = await execAsync(
          `git -C ${worktreePath} status --porcelain`
        ).catch(() => ({ stdout: '' }));

        if (statusOutput.trim()) {
          // Remove any tracked-but-gitignored files before committing
          const trackedIgnored = await shellExec(
            `git -C ${worktreePath} ls-files --ignored --exclude-standard`,
            { cwd: worktreePath }
          );
          if (trackedIgnored.exitCode === 0 && trackedIgnored.stdout.trim()) {
            const files = trackedIgnored.stdout.trim().split('\n')
              .filter(f => f.trim())
              .slice(0, 100); // safety limit
            for (const file of files) {
              await shellExec(
                `git -C ${worktreePath} rm --cached "${file.trim()}"`,
                { cwd: worktreePath }
              ).catch(() => {});
            }
            executionLogger.log({
              event: 'untracked_ignored_files',
              count: files.length,
              project: project.id
            });
          }

          await execAsync(`git -C ${worktreePath} add -A`);
          await execAsync(
            `git -C ${worktreePath} commit -m "feat(${beadId}): ${beadInfo.title}"`
          );
          executionLogger.log({ event: 'commit_made', beadId, project: project.id, sessionId });
          await notionLogger.logTimelineEvent(state.notionPageId, 'success', `Committed changes for ${beadId}`);
        }

        // Collect commits for this bead
        const { stdout: commitLog } = await execAsync(
          `git -C ${worktreePath} log ${beforeCommit.trim()}..HEAD --oneline`
        ).catch(() => ({ stdout: '' }));
        state.results[i].commits = commitLog.trim().split('\n').filter(Boolean);

        // Mark in_review (build check deferred to end of batch)
        await execAsync(`${BD} update ${beadId} --status in_review`).catch(() => {});
        executionLogger.log({ event: 'bead_in_review', beadId, project: project.id, sessionId });
        state.results[i].status = 'completed';
      } else {
        state.results[i].status = 'failed';
        state.results[i].error = 'Phase execution failed';
        executionLogger.log({ event: 'bead_failed', beadId, project: project.id, sessionId, reason: 'phase failed' });
        await notionLogger.logTimelineEvent(state.notionPageId, 'failed', `Bead ${beadId} failed`);
      }
    } catch (err) {
      state.results[i].status = 'failed';
      state.results[i].error = String(err).slice(0, 200);
      executionLogger.log({ event: 'bead_failed', beadId, project: project.id, sessionId, reason: String(err) });
      await notionLogger.logTimelineEvent(state.notionPageId, 'failed', `Bead ${beadId} error: ${String(err).slice(0, 100)}`);
    } finally {
      // 10. Cleanup
      await cleanupTask(beadId, sessionId);
    }

    // 9. Save progress
    await saveBatchState(state);
  }

  // ─── Intermediate push — make worktree commits visible to main clone for build ─
  await execAsync(`git -C ${worktreePath} push origin ${state.branch}`).catch(() => {});
  // Persist state — if process crashes during build/review, resume can detect all beads done
  await saveBatchState(state);

  // ─── Post-loop: review, approve, PR ───────────────────────────────────────

  const completedBeads = state.results.filter(r => r.status === 'completed');
  if (completedBeads.length === 0) {
    state.status = 'failed';
    await saveBatchState(state);
    await notionLogger.logTimelineEvent(state.notionPageId, 'failed', 'No beads completed — batch failed');
    await sendIMessage(ISAIAH,
      `Batch ${state.batchId} finished with 0 completions.\nCheck Notion: ${notionLogger.pageUrl(state.notionPageId)}`
    );
    await cleanupBatchWorktree(project, worktreePath);
    await deleteBatchState(state.batchId);
    return;
  }

  // ─── Final build check (once, after all beads, on MAIN CLONE) ──────────────
  await notionLogger.logTimelineEvent(state.notionPageId, 'running', 'Running final build check...');
  const finalBuild = await runFinalBuildCheck(project, state.branch, worktreePath);
  await notionLogger.logTimelineEvent(
    state.notionPageId,
    finalBuild.success ? 'success' : 'failed',
    `Build: ${finalBuild.success ? 'PASSING' : 'FAILED'}`
  );
  if (!finalBuild.success) {
    // Auto-fix attempt (1 cycle)
    const errors = finalBuild.output.split('\n').filter(l => l.includes('error:')).slice(0, 15).join('\n');
    const fixSession: TaskSession = {
      sessionId, beadId: 'build-fix', taskName: 'Build Fix',
      notionPageId: state.notionPageId, startedAt: new Date(), phases: []
    };
    const fixResult = await runPhase(fixSession, {
      number: 98, id: 'build-fix', name: 'Build Fix',
      prompt: `Fix these build errors:\n\n${errors}\n\nFix ONLY what is needed. Do not change business logic. Do not run git commands.`,
      workingDir: worktreePath
    }, { skipClaim: true, skipCleanup: true, silent: true });

    if (fixResult.success) {
      const { stdout: fixStatus } = await execAsync(`git -C ${worktreePath} status --porcelain`).catch(() => ({ stdout: '' }));
      if (fixStatus.trim()) {
        await execAsync(`git -C ${worktreePath} add -A`);
        await execAsync(`git -C ${worktreePath} commit -m "fix: build errors (auto-fix)"`);
        // Push fix commit so main clone can re-build
        await execAsync(`git -C ${worktreePath} push origin ${state.branch}`).catch(() => {});
      }
    }
    // Re-check build on main clone
    const retryBuild = await runFinalBuildCheck(project, state.branch, worktreePath);
    if (!retryBuild.success) {
      state.status = 'paused';
      await saveBatchState(state);
      await sendIMessage(ISAIAH,
        `Build auto-fix failed for ${state.batchId}.\nErrors:\n${errors.slice(0, 400)}\nBranch: ${state.branch}\nNotion: ${notionLogger.pageUrl(state.notionPageId)}`
      );
      return;
    }
  }

  // Run review agent on full diff
  const reviewSession: TaskSession = {
    sessionId,
    beadId: `batch-${state.batchId}`,
    taskName: `Batch review: ${state.batchId}`,
    notionPageId: state.notionPageId,
    startedAt: new Date(),
    phases: [],
  };
  const review = await runReviewAgent(
    reviewSession,
    worktreePath,
    project.defaultBranch,
    `Batch: ${completedBeads.map(b => b.beadId).join(', ')}`,
    state.notionPageId
  );

  // ─── Auto-remediation ──────────────────────────────────────────────────
  const currentCycle = state.fixCycle ?? 0;

  if (review.status === 'NEEDS_CHANGES') {
    const parsed = parseReviewConcerns(review.rawOutput);
    const blockers = parsed.filter(c => c.severity === 'blocker');
    const fixable = parsed.filter(c => c.severity !== 'low');

    // Alert immediately on blockers
    if (blockers.length > 0) {
      await sendIMessage(ISAIAH,
        `BLOCKER in batch ${state.batchId} (cycle ${currentCycle}):\n` +
        blockers.map(b => `- ${b.title}`).join('\n') + '\n' +
        `Notion: ${notionLogger.pageUrl(state.notionPageId)}`
      );
    }

    if (fixable.length > 0 && currentCycle < 2) {
      // Create fix beads and kick off a fix batch
      const fixBeadIds = await createFixBeads(parsed, project.localPath, state.batchId);

      // CHECKLIST: Never fail silently on 0 fix beads for non-LOW concerns
      if (fixBeadIds.length === 0 && fixable.length > 0) {
        await sendIMessage(ISAIAH,
          `WARNING: createFixBeads returned 0 beads for ${fixable.length} non-LOW concern(s) in batch ${state.batchId}.\n` +
          `Concerns:\n${fixable.map(c => `- [${c.severity}] ${c.title}`).join('\n')}\n` +
          `Notion: ${notionLogger.pageUrl(state.notionPageId)}\n\n` +
          `This is a bug — fix beads should have been created. Pausing batch.`
        );
        state.status = 'paused';
        await saveBatchState(state);
        return;
      }
      const severityCounts = {
        blocker: blockers.length,
        high: parsed.filter(c => c.severity === 'high').length,
        medium: parsed.filter(c => c.severity === 'medium').length,
        low: parsed.filter(c => c.severity === 'low').length,
      };

      await notionLogger.logTimelineEvent(
        state.notionPageId,
        'running',
        `Auto-remediation cycle ${currentCycle + 1}: ${fixBeadIds.length} fix bead(s) created ` +
        `(${severityCounts.blocker}B/${severityCounts.high}H/${severityCounts.medium}M/${severityCounts.low}L)`
      );

      await sendIMessage(ISAIAH,
        `Batch ${state.batchId} — review returned NEEDS_CHANGES.\n` +
        `${severityCounts.blocker} blocker, ${severityCounts.high} high, ${severityCounts.medium} medium, ${severityCounts.low} low.\n` +
        `Starting auto-fix cycle ${currentCycle + 1}/2 with ${fixBeadIds.length} fix bead(s).\n` +
        `Notion: ${notionLogger.pageUrl(state.notionPageId)}`
      );

      const fixState: BatchState = {
        batchId: `${state.batchId}-fix${currentCycle + 1}`,
        projectId: state.projectId,
        branch: state.branch,
        notionPageId: state.notionPageId,
        sessionId: state.sessionId,
        status: 'queued',
        beadOrder: fixBeadIds,
        currentIndex: 0,
        results: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        overnight: state.overnight,
        fixCycle: currentCycle + 1,
        worktreePath, // inherit parent batch's worktree
      };
      await saveBatchState(fixState);

      // Recurse — fix batch goes through the full loop
      await runBatchAsync(fixState, project, sessionId);
      return;
    }

    if (currentCycle >= 2) {
      // Max cycles reached — hand off to Isaiah
      const remaining = parsed.filter(c => c.severity !== 'low');
      await notionLogger.logTimelineEvent(
        state.notionPageId,
        'waiting',
        `Auto-remediation exhausted (${currentCycle} cycles). ${remaining.length} concern(s) remain.`
      );
      await sendIMessage(ISAIAH,
        `Batch ${state.batchId} — ${currentCycle} fix cycles done, still ${remaining.length} concern(s).\n` +
        `Needs your input. Notion: ${notionLogger.pageUrl(state.notionPageId)}`
      );
      state.status = 'paused';
      await saveBatchState(state);
      return; // worktree persists for resume
    }
  }

  // ─── APPROVED or BLOCKED — proceed to PR ─────────────────────────────

  // 12. Build batch PR description
  const prBody = buildBatchPRDescription({
    title: `${project.name} — Batch ${state.batchId}`,
    branch: state.branch,
    beadSections: completedBeads.map(b => ({
      beadId: b.beadId,
      title: b.title,
      commits: b.commits,
    })),
    testCoverage: 'Build: passing',
    reviewStatus: review.status,
    concerns: review.concerns,
  });

  await notionLogger.logPRDraft(state.notionPageId, {
    branch: state.branch,
    beadIds: completedBeads.map(b => b.beadId),
    phases: completedBeads.length,
    testCoverage: 'Build: passing',
  });

  // 13. Ask Isaiah for approval
  const failedCount = state.results.filter(r => r.status === 'failed').length;
  const summary = [
    `Batch ${state.batchId} complete.`,
    `${completedBeads.length} bead(s) done, ${failedCount} failed.`,
    `Review: ${review.status} — ${review.concerns.length} concern(s)`,
    currentCycle > 0 ? `Fix cycles used: ${currentCycle}` : '',
    `Branch: ${state.branch}`,
    `Notion: ${notionLogger.pageUrl(state.notionPageId)}`,
    `Commits are on origin. Approve PR creation?`,
  ].filter(Boolean).join('\n');

  const approved = await waitForApproval(reviewSession, summary, {
    onReping: async () => { await saveBatchState(state); },
  });

  if (approved) {
    // Only push again if auto-fix added commits after intermediate push
    const { stdout: aheadCount } = await execAsync(
      `git -C ${worktreePath} rev-list origin/${state.branch}..HEAD --count`
    ).catch(() => ({ stdout: '0' }));

    if (parseInt(aheadCount.trim()) > 0) {
      await execAsync(`git -C ${worktreePath} push origin ${state.branch}`);
    }
    executionLogger.log({ event: 'branch_pushed', project: project.id, sessionId, branch: state.branch });

    const prUrl = await createDraftPR(
      worktreePath,
      `${project.name} — Batch ${state.batchId}`,
      prBody
    );
    state.prUrl = prUrl;

    for (const bead of completedBeads) {
      await execAsync(`${BD} close ${bead.beadId} --reason "PR created: ${prUrl}"`).catch(() => {});
      executionLogger.log({ event: 'bead_complete', beadId: bead.beadId, project: project.id, sessionId, prUrl });
    }

    state.status = 'approved';
    await saveBatchState(state);
    await notionLogger.logTimelineEvent(state.notionPageId, 'success', `PR created: ${prUrl}`);
    await sendIMessage(ISAIAH, `Batch PR open: ${prUrl}`);

    if (state.label) {
      const nextPhase = getNextPhase(project, state.label);
      if (nextPhase) {
        await sendIMessage(ISAIAH,
          `Ready for ${nextPhase} when you are.\nText "${project.id} batch ${nextPhase}" to continue.`
        );
      } else if (isFinalPhase(project, state.label)) {
        await sendIMessage(ISAIAH,
          `All phases complete. Migration done.\nAWS infra is ready to decommission when you are.`
        );
      }
    }

    await cleanupBatchWorktree(project, worktreePath);
    await deleteBatchState(state.batchId);
  } else {
    // 15. Declined — reopen all beads
    for (const bead of completedBeads) {
      await execAsync(`${BD} update ${bead.beadId} --status open`).catch(() => {});
    }

    state.status = 'declined';
    await saveBatchState(state);
    await notionLogger.logTimelineEvent(state.notionPageId, 'failed', 'Push declined — beads reopened');
    await sendIMessage(ISAIAH, `Batch push declined. ${completedBeads.length} bead(s) reopened.`);
    await cleanupBatchWorktree(project, worktreePath);
    // Keep declined state for 1h visibility, then auto-expire
    const redis = getRedis();
    await redis.expire(`${BATCH_KEY_PREFIX}${state.batchId}`, 3600);
  }
}
