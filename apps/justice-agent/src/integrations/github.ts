import { exec } from 'child_process';
import { promisify } from 'util';
import { waitForApproval } from '../modes/code-executor';
import type { TaskSession } from '../modes/code-executor';

const execAsync = promisify(exec);

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

// Create a new branch for a task
// Branch name: feature/bd-[beadId]-[short-name]
export async function createTaskBranch(
  localPath: string,
  beadId: string,
  shortName: string
): Promise<string> {
  const branch = `feature/${beadId}-${shortName.toLowerCase().replace(/\s+/g, '-').slice(0, 30)}`;
  await execAsync(`git -C ${localPath} checkout -b ${branch}`);
  console.log(`[github] Created branch ${branch}`);
  return branch;
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
}): string {
  return [
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
    '',
    '### Status',
    'Pending Isaiah review and merge approval.',
  ].join('\n');
}
