import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { waitForApproval } from '../modes/code-executor';
import type { TaskSession } from '../modes/code-executor';
import { getRedis } from './redis-client';
import { executionLogger } from './execution-logger';

const execAsync = promisify(exec);
const WORKTREE_BASE = path.join(process.env.HOME!, 'Developer/ios/.worktrees');
const MAX_WORKTREES = 5;

export interface GitProject {
  name: string;
  githubUrl: string;
  localPath: string;
  defaultBranch: string;
}

// Clone a repo if not already cloned, otherwise pull latest
export async function ensureRepo(project: GitProject): Promise<void> {
  const fs = require('fs');
  if (!fs.existsSync(project.localPath)) {
    await execAsync(`git clone ${project.githubUrl} ${project.localPath}`);
    console.log(`[github] Cloned ${project.name} to ${project.localPath}`);
  } else {
    await execAsync(`git -C ${project.localPath} pull origin ${project.defaultBranch}`);
    console.log(`[github] Pulled latest for ${project.name}`);
  }
}

// Create or switch to a task branch
// Branch name: feature/[beadId]-[short-name]
export async function createTaskBranch(
  localPath: string,
  beadId: string,
  shortName: string
): Promise<string> {
  const branch = `feature/${beadId}-${shortName.toLowerCase().replace(/\s+/g, '-').slice(0, 30)}`;
  try {
    await execAsync(`git -C ${localPath} checkout -b ${branch}`);
    console.log(`[github] Created branch ${branch}`);
  } catch {
    // Branch already exists — switch to it
    await execAsync(`git -C ${localPath} checkout ${branch}`);
    console.log(`[github] Switched to existing branch ${branch}`);
  }
  return branch;
}

// ─── Worktree management for concurrent batches ─────────────────────────────

export async function createBatchWorktree(
  project: GitProject,
  branchName: string,
  batchId: string
): Promise<string> {
  const worktreePath = path.join(WORKTREE_BASE, `${(project as any).id ?? project.name}-${batchId}`);

  // Redis mutex — prevent concurrent worktree add race
  const redis = getRedis();
  const lockKey = `justice:worktree:lock:${(project as any).id ?? project.name}`;
  let acquired = await redis.set(lockKey, batchId, 'EX', 30, 'NX');
  if (!acquired) {
    await new Promise(r => setTimeout(r, 2000));
    acquired = await redis.set(lockKey, batchId, 'EX', 30, 'NX');
    if (!acquired) throw new Error(`Could not acquire worktree lock for ${project.name}`);
  }

  try {
    // Safety: check worktree count
    const { stdout: listOut } = await execAsync(`git -C ${project.localPath} worktree list`);
    const worktreeCount = listOut.trim().split('\n').length - 1; // subtract main worktree
    if (worktreeCount >= MAX_WORKTREES) {
      throw new Error(`Max worktrees (${MAX_WORKTREES}) reached for ${project.name}. Clean up stale batches first.`);
    }

    // Ensure parent dir exists
    if (!fs.existsSync(WORKTREE_BASE)) {
      fs.mkdirSync(WORKTREE_BASE, { recursive: true });
    }

    // Remove any stale worktree already on this branch
    const { stdout: existingList } = await execAsync(
      `git -C ${project.localPath} worktree list --porcelain`
    ).catch(() => ({ stdout: '' }));

    const worktreeBlocks = existingList.split('\n\n').filter(Boolean);
    for (const block of worktreeBlocks) {
      const pathMatch = block.match(/^worktree (.+)/m);
      const branchMatch = block.match(/^branch refs\/heads\/(.+)/m);
      if (branchMatch?.[1] === branchName && pathMatch?.[1]) {
        const stalePath = pathMatch[1].trim();
        console.log(`[createBatchWorktree] Removing stale worktree at ${stalePath} for branch ${branchName}`);
        await execAsync(
          `git -C ${project.localPath} worktree remove "${stalePath}" --force`
        ).catch(() => {});
      }
    }

    // Prune any leftover worktree metadata
    await execAsync(
      `git -C ${project.localPath} worktree prune`
    ).catch(() => {});

    // If worktree path already exists, check if it's valid or stale
    if (fs.existsSync(worktreePath)) {
      const { stdout: wtList } = await execAsync(
        `git -C ${project.localPath} worktree list --porcelain`
      ).catch(() => ({ stdout: '' }));
      if (wtList.includes(worktreePath)) {
        // Already registered — reuse it
        console.log(`[github] Reusing existing worktree: ${worktreePath}`);
        return worktreePath;
      }
      // Stale directory — clean it up
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }

    // Check if branch exists locally
    const { stdout: localBranch } = await execAsync(
      `git -C ${project.localPath} branch --list "${branchName}"`
    ).catch(() => ({ stdout: '' }));
    const branchExists = localBranch.trim().length > 0;

    if (!branchExists) {
      // Check remote
      const { stdout: remoteBranch } = await execAsync(
        `git -C ${project.localPath} branch -r --list "origin/${branchName}"`
      ).catch(() => ({ stdout: '' }));

      if (remoteBranch.trim().length > 0) {
        // Only on remote — fetch and create local tracking branch, then attach worktree
        await execAsync(`git -C ${project.localPath} fetch origin ${branchName}`);
        await execAsync(
          `git -C ${project.localPath} branch --track "${branchName}" "origin/${branchName}"`
        );
        await execAsync(
          `git -C ${project.localPath} worktree add "${worktreePath}" "${branchName}"`
        );
      } else {
        // Truly new branch — create with -b
        await execAsync(
          `git -C ${project.localPath} worktree add -b "${branchName}" "${worktreePath}"`
        );
      }
    } else {
      // Local branch exists — attach worktree (no -b)
      await execAsync(
        `git -C ${project.localPath} worktree add "${worktreePath}" "${branchName}"`
      );
    }

    executionLogger.log({ event: 'worktree_created', project: project.name, batchId, worktreePath });
    console.log(`[github] Created worktree: ${worktreePath} on branch ${branchName}`);
    return worktreePath;
  } finally {
    await redis.del(lockKey);
  }
}

export async function cleanupBatchWorktree(
  project: GitProject,
  worktreePath: string
): Promise<void> {
  if (!worktreePath || !worktreePath.includes('.worktrees')) return; // safety guard

  try {
    await execAsync(`git -C ${project.localPath} worktree remove ${worktreePath} --force`);
  } catch {
    // Fallback: manual cleanup
    try {
      if (fs.existsSync(worktreePath)) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
      await execAsync(`git -C ${project.localPath} worktree prune`);
    } catch { /* best effort */ }
  }

  executionLogger.log({ event: 'worktree_cleaned', project: project.name, worktreePath });
  console.log(`[github] Cleaned up worktree: ${worktreePath}`);
}

export async function cleanupStaleWorktrees(
  project: GitProject,
  activeBatchIds: string[]
): Promise<void> {
  try {
    const { stdout } = await execAsync(`git -C ${project.localPath} worktree list --porcelain`);
    const projectPrefix = `${(project as any).id ?? project.name}-`;

    // Parse porcelain output: each worktree block starts with "worktree <path>"
    const lines = stdout.split('\n');
    for (const line of lines) {
      if (!line.startsWith('worktree ')) continue;
      const wtPath = line.replace('worktree ', '').trim();
      if (!wtPath.includes('.worktrees')) continue;

      const dirName = path.basename(wtPath);
      if (!dirName.startsWith(projectPrefix)) continue;

      // Extract batchId from directory name: {projectId}-{batchId}
      const batchId = dirName.slice(projectPrefix.length);
      if (!activeBatchIds.includes(batchId)) {
        await cleanupBatchWorktree(project, wtPath);
        console.log(`[github] Pruned stale worktree: ${wtPath} (batch ${batchId})`);
      }
    }

    await execAsync(`git -C ${project.localPath} worktree prune`);
  } catch {
    // Best effort — don't crash startup
  }
}

// Stage and commit all changes
export async function commitPhase(
  localPath: string,
  beadId: string,
  phaseDescription: string
): Promise<void> {
  await execAsync(`git -C ${localPath} add -A`);
  const { stdout } = await execAsync(`git -C ${localPath} status --short`);
  if (!stdout.trim()) {
    console.log('[github] Nothing to commit');
    return;
  }
  const message = `${phaseDescription} (${beadId})`;
  await execAsync(`git -C ${localPath} commit -m "${message}"`);
  console.log(`[github] Committed: ${message}`);
}

// Push branch — ALWAYS requires approval
export async function pushBranch(
  session: TaskSession,
  localPath: string,
  branch: string
): Promise<boolean> {
  const approved = await waitForApproval(
    session,
    `Approve push of branch ${branch} to GitHub?`
  );
  if (!approved) {
    console.log('[github] Push declined by Isaiah');
    return false;
  }
  await execAsync(`git -C ${localPath} push origin ${branch}`);
  console.log(`[github] Pushed ${branch}`);
  return true;
}

// Draft a PR description — logs to Notion, never auto-creates on GitHub
export function buildPRDescription(opts: {
  title: string;
  branch: string;
  beadIds: string[];
  phases: string[];
  testCoverage: string;
  reviewStatus?: string;
  concerns?: string[];
}): string {
  const lines = [
    `## ${opts.title}`,
    '',
    `**Branch:** \`${opts.branch}\``,
    `**Related beads:** ${opts.beadIds.join(', ')}`,
    '',
    '### Changes',
    ...opts.phases.map(p => `- ${p}`),
    '',
    `### Test coverage`,
    opts.testCoverage,
  ];

  if (opts.reviewStatus) {
    lines.push('', `### Review agent: ${opts.reviewStatus}`);
    if (opts.concerns && opts.concerns.length > 0) {
      lines.push(...opts.concerns.map(c => `- ${c}`));
    }
  }

  lines.push('', '### Status', 'Pending Isaiah review and merge approval.');
  return lines.join('\n');
}

// Build a batch PR description with per-bead sections
export function buildBatchPRDescription(opts: {
  title: string;
  branch: string;
  beadSections: Array<{ beadId: string; title: string; commits: string[] }>;
  testCoverage: string;
  reviewStatus?: string;
  concerns?: string[];
}): string {
  const beadIds = opts.beadSections.map(s => s.beadId);
  const lines = [
    `## ${opts.title}`,
    `**Branch:** \`${opts.branch}\``,
    `**Beads:** ${beadIds.join(', ')}`,
    '',
    '### Changes by bead',
  ];

  for (const section of opts.beadSections) {
    lines.push('', `#### ${section.beadId}: ${section.title}`);
    if (section.commits.length > 0) {
      lines.push(...section.commits.map(c => `- ${c}`));
    } else {
      lines.push('- (no commits)');
    }
  }

  lines.push('', '### Build', opts.testCoverage);

  if (opts.reviewStatus) {
    const concernCount = opts.concerns?.length ?? 0;
    lines.push('', `### Review agent`, `${opts.reviewStatus} — ${concernCount} concern(s)`);
    if (opts.concerns && opts.concerns.length > 0) {
      lines.push(...opts.concerns.map(c => `- ${c}`));
    }
  }

  lines.push('', '### Status', 'Pending Isaiah review and merge approval.');
  return lines.join('\n');
}

// Create a draft PR on GitHub via gh CLI. Returns the PR URL.
export async function createDraftPR(
  localPath: string,
  title: string,
  body: string
): Promise<string> {
  const fs = require('fs');
  const bodyFile = `/tmp/pr-body-${Date.now()}.md`;
  fs.writeFileSync(bodyFile, body, 'utf8');
  try {
    const { stdout } = await execAsync(
      `gh pr create --draft --title ${JSON.stringify(title)} --body-file ${JSON.stringify(bodyFile)}`,
      { cwd: localPath }
    );
    const prUrl = stdout.trim();
    console.log(`[github] Draft PR created: ${prUrl}`);
    return prUrl;
  } finally {
    fs.unlinkSync(bodyFile);
  }
}
