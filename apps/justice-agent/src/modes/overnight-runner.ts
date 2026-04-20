import { exec } from 'child_process';
import { promisify } from 'util';
import { notionLogger } from '../integrations/notion-logger';
import { sendIMessage } from '@justice/messaging';
import { atomicClaim, cleanupTask } from '@justice/shared-types';
import { runPhase } from './code-executor';
import { runReviewAgent } from './review-agent';
import { getProject, type iOSProject } from '../registry/ios-projects';
import { buildPRDescription, createDraftPR, pushBranch, createTaskBranch, commitPhase } from '../integrations/github';
import { createApproval, getApproval, formatStamp } from '../integrations/approval-gate';
import { executionLogger } from '../integrations/execution-logger';
import { getRedis } from '../integrations/redis-client';

const execAsync = promisify(exec);
const ISAIAH = process.env.APPROVED_NUMBER_ISAIAH!;

export interface OvernightRunResult {
  projectId: string;
  beadsDone: string[];
  beadsFailed: string[];
  beadsBlocked: string[];
  buildPassing: boolean;
  reviewStatus: string;
  prBranch: string;
  notionPageId: string;
}

export async function runOvernightSession(projectId: string): Promise<void> {
  const project = getProject(projectId);
  if (!project) {
    await sendIMessage(ISAIAH, `Unknown project: ${projectId}`);
    return;
  }

  const date = new Date().toISOString().split('T')[0];
  const sessionId = `overnight-${projectId}-${date}`;

  // Create Notion run page
  const pageId = await notionLogger.createTaskPage(
    `${project.name} Overnight Run — ${date}`,
    `Autonomous overnight run for ${project.name}. All unblocked beads will be processed.`
  );

  await sendIMessage(
    ISAIAH,
    `${project.name} overnight run started.\nCheck Notion for live progress: ${notionLogger.pageUrl(pageId)}`
  );

  // Get all unblocked beads for this project
  const { stdout: readyOutput } = await execAsync(
    `bd ready --json 2>/dev/null || bd list --status open --json`
  ).catch(() => ({ stdout: '[]' }));

  let beads: any[] = [];
  try {
    beads = JSON.parse(readyOutput);
  } catch {
    beads = [];
  }

  // Filter to this project's beads
  const projectBeads = beads.filter((b: any) =>
    b.labels?.includes(projectId) || b.title?.toLowerCase().includes(projectId)
  );

  if (projectBeads.length === 0) {
    await sendIMessage(ISAIAH,
      `${project.name}: No unblocked beads found. Nothing to run tonight.`
    );
    return;
  }

  const done: string[] = [];
  const failed: string[] = [];
  let buildPassing = false;
  let prBranch = '';

  // Create branch for this run
  prBranch = `feature/overnight-${projectId}-${date}`;
  await execAsync(`git -C ${project.localPath} checkout -b ${prBranch}`).catch(async () => {
    // Branch may exist
    await execAsync(`git -C ${project.localPath} checkout ${prBranch}`);
  });

  // Process each bead
  for (const bead of projectBeads) {
    const claimed = await atomicClaim(bead.id, sessionId);
    if (!claimed) {
      failed.push(`${bead.id} (already claimed)`);
      continue;
    }
    executionLogger.log({ event: 'bead_claimed', beadId: bead.id, project: projectId, sessionId });
    await notionLogger.logTimelineEvent(pageId, 'running', `Claimed bead ${bead.id}: ${bead.title}`);

    await notionLogger.logPhaseStart(pageId, {
      number: projectBeads.indexOf(bead) + 1,
      id: bead.id,
      name: bead.title,
      prompt: bead.title
    });

    try {
      // Spawn Claude Code for this bead
      const result = await runPhase(
        { sessionId, beadId: bead.id, taskName: bead.title, notionPageId: pageId, startedAt: new Date(), phases: [] },
        {
          number: projectBeads.indexOf(bead) + 1,
          id: bead.id,
          name: bead.title,
          prompt: `Complete this task: ${bead.title}\n\nAcceptance criteria:\n${bead.description ?? 'See bead details'}\n\nProject: ${project.name} at ${project.localPath}\nBranch: ${prBranch}`,
          workingDir: project.localPath
        }
      );

      if (result.success) {
        // Commit after each successful bead
        await commitPhase(project.localPath, bead.id, bead.title);
        executionLogger.log({ event: 'commit_made', beadId: bead.id, project: projectId, sessionId });
        await notionLogger.logTimelineEvent(pageId, 'success', `Committed changes for ${bead.id}`);

        // Build check
        const buildResult = await runBuildCheck(project);
        buildPassing = buildResult.success;
        executionLogger.log({ event: 'build_check', beadId: bead.id, project: projectId, success: buildResult.success });
        await notionLogger.logTimelineEvent(pageId, buildResult.success ? 'success' : 'failed', `Build ${buildResult.success ? 'passed' : 'failed'} after ${bead.id}`);

        if (!buildResult.success) {
          await notionLogger.logQuestion(pageId,
            `Build failed after ${bead.id}. Skipping remaining beads.\n\n${buildResult.output}`
          );
          failed.push(`${bead.id} (build broke)`);
          executionLogger.log({ event: 'bead_failed', beadId: bead.id, project: projectId, reason: 'build broke' });
          await cleanupTask(bead.id, sessionId);
          break;
        }

        await execAsync(`${process.env.HOME}/.local/bin/bd update ${bead.id} --status in_review`).catch(() => {});
        executionLogger.log({ event: 'bead_in_review', beadId: bead.id, project: projectId, sessionId });
        await notionLogger.logTimelineEvent(pageId, 'waiting', `Bead ${bead.id} in review`);
        done.push(bead.id);
      } else {
        failed.push(bead.id);
        executionLogger.log({ event: 'bead_failed', beadId: bead.id, project: projectId, reason: 'phase failed' });
        await notionLogger.logTimelineEvent(pageId, 'failed', `Bead ${bead.id} failed`);
      }

    } catch (err) {
      failed.push(`${bead.id} (error: ${err})`);
      executionLogger.log({ event: 'bead_failed', beadId: bead.id, project: projectId, reason: String(err) });
      await notionLogger.logTimelineEvent(pageId, 'failed', `Bead ${bead.id} error: ${String(err).slice(0, 100)}`);
    } finally {
      await cleanupTask(bead.id, sessionId);
    }
  }

  // Final build check
  const finalBuild = await runBuildCheck(project);
  buildPassing = finalBuild.success;

  // Run review agent
  const reviewResult = await runReviewAgent(
    { sessionId, beadId: 'overnight-review', taskName: 'Review', notionPageId: pageId, startedAt: new Date(), phases: [] },
    project.localPath,
    project.defaultBranch,
    `Overnight run: ${done.join(', ')}`,
    pageId
  );

  // Log PR draft to Notion (push deferred to morning)
  const prBody = buildPRDescription({
    title: `${project.name} — Overnight Run ${date}`,
    branch: prBranch,
    beadIds: done,
    phases: done.map(id => `Completed: ${id}`),
    testCoverage: `Build: ${buildPassing ? 'passing' : 'failing'}`,
    reviewStatus: reviewResult.status,
    concerns: reviewResult.concerns,
  });

  await notionLogger.logPRDraft(pageId, {
    branch: prBranch,
    beadIds: done,
    phases: done.length,
    testCoverage: `Build: ${buildPassing ? 'passing' : 'failing'}`
  });

  // Morning summary iMessage with approval stamp
  const concernsSummary = reviewResult.concerns.length > 0
    ? `Review: ${reviewResult.concerns.length} concern(s)`
    : 'Review: clean';

  const stamp = await createApproval(sessionId, `Push overnight branch ${prBranch}`);

  const summary = [
    `[${project.name}] Overnight run complete — ${date} ${formatStamp(stamp)}`,
    ``,
    `${done.length} bead(s) in review. ${failed.length} failed.`,
    `Build: ${buildPassing ? 'passing' : 'failing'}`,
    concernsSummary,
    done.length > 0 ? `${done.length} PR(s) ready.` : '',
    ``,
    `Check Notion: ${notionLogger.pageUrl(pageId)}`,
    `Approve push? Reply "yes ${stamp}" or "no ${stamp}"`
  ].filter(Boolean).join('\n');

  await sendIMessage(ISAIAH, summary);

  // Poll for approval (check every 30s, timeout 12h)
  const approved = await new Promise<boolean>((resolve) => {
    const poll = setInterval(async () => {
      try {
        const approval = await getApproval(stamp);
        if (!approval) { clearInterval(poll); resolve(false); return; }
        if (approval.status === 'YES') { clearInterval(poll); resolve(true); }
        else if (approval.status === 'NO') { clearInterval(poll); resolve(false); }
      } catch { /* keep polling */ }
    }, 30_000);
    setTimeout(() => { clearInterval(poll); resolve(false); }, 12 * 60 * 60 * 1000);
  });

  if (approved && done.length > 0) {
    // Push branch + create draft PR + close all beads
    await execAsync(`git -C ${project.localPath} push origin ${prBranch}`);
    executionLogger.log({ event: 'branch_pushed', project: projectId, sessionId, branch: prBranch });

    const prUrl = await createDraftPR(
      project.localPath,
      `${project.name} — Overnight Run ${date}`,
      prBody
    );

    for (const beadId of done) {
      await execAsync(`${process.env.HOME}/.local/bin/bd close ${beadId} --reason "PR created: ${prUrl}"`).catch(() => {});
      executionLogger.log({ event: 'bead_complete', beadId, project: projectId, sessionId, prUrl });
    }

    await notionLogger.logTimelineEvent(pageId, 'success', `PR created: ${prUrl}`);
    await sendIMessage(ISAIAH, `PR open: ${prUrl}`);
  } else if (!approved && done.length > 0) {
    // Push declined — reopen all beads
    for (const beadId of done) {
      await execAsync(`${process.env.HOME}/.local/bin/bd update ${beadId} --status open`).catch(() => {});
    }
    await notionLogger.logTimelineEvent(pageId, 'failed', 'Push declined — beads reopened');
    await sendIMessage(ISAIAH, `Push declined. ${done.length} bead(s) reopened.`);
  }
}

export async function runBuildCheck(project: iOSProject, overridePath?: string): Promise<{ success: boolean; output: string }> {
  const basePath = overridePath ?? project.localPath;
  try {
    const { stdout, stderr } = await execAsync(
      `xcodebuild build -scheme ${project.xcodeSchemeName} ` +
      `-destination 'platform=iOS Simulator,name=iPhone 16e' ` +
      `-skipMacroValidation -skipPackagePluginValidation ` +
      `CODE_SIGNING_ALLOWED=NO 2>&1 | tail -20`,
      { cwd: project.xcodeRoot ? require('path').join(basePath, project.xcodeRoot) : basePath, timeout: 300_000 }
    );
    const output = stdout + stderr;
    const success = output.includes('BUILD SUCCEEDED');
    return { success, output };
  } catch (err: any) {
    return { success: false, output: err.message ?? 'Build failed' };
  }
}

/**
 * Final build check for batches — builds in the worktree where the branch
 * is already checked out. Never does `git checkout` on main clone because
 * git refuses to checkout a branch that is active in a worktree.
 *
 * Falls back to main clone only when no worktree exists and the branch
 * is not active in any worktree.
 */
export async function runFinalBuildCheck(
  project: iOSProject,
  branch: string,
  worktreePath?: string
): Promise<{ success: boolean; output: string }> {
  const fs = require('fs');
  const redis = getRedis();
  const lockKey = `justice:build:lock:${project.id}`;
  const maxWaitMs = 15 * 60 * 1000;
  const pollMs = 10_000;
  let waited = 0;
  while (waited < maxWaitMs) {
    const acquired = await redis.set(lockKey, branch, 'EX', 600, 'NX');
    if (acquired === 'OK') break;
    await new Promise(r => setTimeout(r, pollMs));
    waited += pollMs;
  }
  try {
    // Prefer worktree — the branch is already checked out there
    if (worktreePath && fs.existsSync(worktreePath)) {
      return await runBuildCheck(project, worktreePath);
    }

    // No usable worktree — check if branch is active in any worktree
    const { stdout: worktreeList } = await execAsync(
      `git -C ${project.localPath} worktree list --porcelain`
    ).catch(() => ({ stdout: '' }));

    const branchInWorktree = worktreeList.includes(`refs/heads/${branch}`);

    if (!branchInWorktree) {
      // Safe to checkout on main clone
      await execAsync(`git -C ${project.localPath} fetch origin ${branch} --quiet`).catch(() => {});
      await execAsync(`git -C ${project.localPath} checkout ${branch}`);
      return await runBuildCheck(project);
    }

    // Branch is in a worktree — extract its path and build there
    const lines = worktreeList.split('\n');
    let detectedPath: string | null = null;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('worktree ') && lines[i + 1]?.includes(`refs/heads/${branch}`)) {
        detectedPath = lines[i].replace('worktree ', '').trim();
        break;
      }
    }

    if (detectedPath && fs.existsSync(detectedPath)) {
      return await runBuildCheck(project, detectedPath);
    }

    return { success: false, output: `Cannot build: branch ${branch} is in a worktree but path cannot be determined.` };
  } finally {
    await redis.del(lockKey);
  }
}
