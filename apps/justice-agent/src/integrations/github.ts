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
