import { exec } from 'child_process';
import { promisify } from 'util';
import { notionLogger } from '../integrations/notion-logger';
import { sendIMessage } from '@justice/messaging';
import { atomicClaim, cleanupTask } from '@justice/shared-types';
import { runPhase } from './code-executor';
import { runReviewAgent } from './review-agent';
import { getProject, type iOSProject } from '../registry/ios-projects';
import { buildPRDescription, pushBranch, createTaskBranch, commitPhase } from '../integrations/github';
import { createApproval, formatStamp } from '../integrations/approval-gate';

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

        // Build check
        const buildResult = await runBuildCheck(project);
        buildPassing = buildResult.success;

        if (!buildResult.success) {
          await notionLogger.logQuestion(pageId,
            `Build failed after ${bead.id}. Skipping remaining beads.\n\n${buildResult.output}`
          );
          failed.push(`${bead.id} (build broke)`);
          await cleanupTask(bead.id, sessionId);
          break;
        }

        await execAsync(`bd close ${bead.id} --reason "Completed in overnight run ${date}"`).catch(() => {});
        done.push(bead.id);
      } else {
        failed.push(bead.id);
      }

    } catch (err) {
      failed.push(`${bead.id} (error: ${err})`);
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
  const prDescription = buildPRDescription({
    title: `${project.name} — Overnight Run ${date}`,
    branch: prBranch,
    beadIds: done,
    phases: done.map(id => `Completed: ${id}`),
    testCoverage: `Build: ${buildPassing ? 'passing' : 'failing'}`
  });

  await notionLogger.logPRDraft(pageId, {
    branch: prBranch,
    beadIds: done,
    phases: done.length,
    testCoverage: `Build: ${buildPassing ? 'passing' : 'failing'}`
  });

  // Morning summary iMessage with approval stamp
  const concerns = reviewResult.concerns.length > 0
    ? `Review: ${reviewResult.concerns.length} concern(s)`
    : 'Review: clean';

  const stamp = await createApproval(sessionId, `Push overnight branch ${prBranch}`);

  const summary = [
    `[${project.name}] Overnight run complete — ${date} ${formatStamp(stamp)}`,
    ``,
    `Beads done: ${done.length} | Failed: ${failed.length}`,
    `Build: ${buildPassing ? 'passing' : 'failing'}`,
    concerns,
    `PR: ready for push approval`,
    ``,
    `Check Notion: ${notionLogger.pageUrl(pageId)}`,
    `Approve push? Reply "yes ${stamp}" or "no ${stamp}"`
  ].join('\n');

  await sendIMessage(ISAIAH, summary);
}

export async function runBuildCheck(project: iOSProject): Promise<{ success: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execAsync(
      `xcodebuild build -scheme ${project.xcodeSchemeName} ` +
      `-destination 'platform=iOS Simulator,name=iPhone 16' ` +
      `CODE_SIGNING_ALLOWED=NO 2>&1 | tail -20`,
      { cwd: project.localPath, timeout: 300_000 }
    );
    const output = stdout + stderr;
    const success = output.includes('BUILD SUCCEEDED');
    return { success, output };
  } catch (err: any) {
    return { success: false, output: err.message ?? 'Build failed' };
  }
}
