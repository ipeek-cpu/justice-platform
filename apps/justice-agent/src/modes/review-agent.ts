import { exec } from 'child_process';
import { promisify } from 'util';
import { notionLogger } from '../integrations/notion-logger';
import { sendIMessage } from '@justice/messaging';
import { runPhase } from './code-executor';
import { shellExec } from '../integrations/shell-exec';

const execAsync = promisify(exec);
const ISAIAH = process.env.APPROVED_NUMBER_ISAIAH!;

export interface ReviewResult {
  status: 'APPROVED' | 'NEEDS_CHANGES' | 'BLOCKED';
  concerns: string[];
  suggestions: string[];
  readyForHumanReview: boolean;
  rawOutput: string;
}

export interface ParsedConcern {
  severity: 'blocker' | 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  file?: string;
  line?: number;
  fixInstruction: string;
}

export async function runReviewAgent(
  session: any,
  projectPath: string,
  baseBranch: string,
  specSummary: string,
  notionPageId: string
): Promise<ReviewResult> {

  // Get diff stats
  const { stdout: diffStat } = await execAsync(
    `git -C ${projectPath} diff ${baseBranch}...HEAD --stat`
  ).catch(() => ({ stdout: 'Could not get diff' }));

  const { stdout: currentBranch } = await execAsync(
    `git -C ${projectPath} branch --show-current`
  );

  // Pre-compute filtered diff (exclude noise, cap at 60KB)
  const EXCLUDE = [
    ':(exclude)*/node_modules/*', ':(exclude)*.DS_Store', ':(exclude)*.jsonl',
    ':(exclude)storybook-static/*', ':(exclude)package-lock.json',
    ':(exclude)pnpm-lock.yaml', ':(exclude)*.lock',
  ].join(' ');
  const { stdout: fullDiff } = await execAsync(
    `git -C ${projectPath} diff ${baseBranch}...HEAD ${EXCLUDE} 2>/dev/null | head -c 61440`,
    { maxBuffer: 80 * 1024 * 1024 }
  ).catch(() => ({ stdout: '' }));

  const reviewPrompt = `
You are a senior code reviewer for an iOS/TypeScript/Python project.
Review branch ${currentBranch.trim()} against ${baseBranch}.

Spec: ${specSummary}

Files changed (stat):
${diffStat}

Diff (filtered, capped 60KB):
\`\`\`diff
${fullDiff || 'No meaningful code changes'}
\`\`\`

Review for: bugs, security issues, hardcoded values, unhandled errors,
SQL injection or RLS gaps in migrations, patterns inconsistent with codebase.

Output EXACTLY:
STATUS: APPROVED | NEEDS_CHANGES | BLOCKED
CONCERNS:
- [severity: SECURITY|BUG|ARCHITECTURE|MEDIUM|LOW] description (file:line if known)
SUGGESTIONS:
- suggestion or "none"
READY_FOR_HUMAN_REVIEW: YES | NO
SUMMARY: one sentence
`;

  const result = await runPhase(session, {
    number: 99,
    id: 'review',
    name: 'Review Agent',
    prompt: reviewPrompt,
    workingDir: projectPath
  });

  const parsed = parseReviewOutput(result.output);

  // Log review to Notion
  await notionLogger.logPhaseComplete(
    notionPageId,
    { number: 99, id: 'review', name: 'Review Agent', prompt: '' },
    result.output,
    result.success ? 0 : 1
  );

  return parsed;
}

function parseReviewOutput(output: string): ReviewResult {
  const statusMatch = output.match(/STATUS:\s*(APPROVED|NEEDS_CHANGES|BLOCKED)/);
  const readyMatch = output.match(/READY_FOR_HUMAN_REVIEW:\s*(YES|NO)/);

  const concernsMatch = output.match(/CONCERNS:\n([\s\S]*?)(?=SUGGESTIONS:|$)/);
  const suggestionsMatch = output.match(/SUGGESTIONS:\n([\s\S]*?)(?=READY_FOR_HUMAN_REVIEW:|$)/);

  const parseBullets = (text: string | undefined): string[] => {
    if (!text) return [];
    return text.split('\n')
      .map(l => l.replace(/^-\s*/, '').trim())
      .filter(l => l && l !== 'none');
  };

  return {
    status: (statusMatch?.[1] as ReviewResult['status']) ?? 'NEEDS_CHANGES',
    concerns: parseBullets(concernsMatch?.[1]),
    suggestions: parseBullets(suggestionsMatch?.[1]),
    readyForHumanReview: readyMatch?.[1] === 'YES',
    rawOutput: output
  };
}

// ─── Auto-remediation helpers ──────────────────────────────────────────────

const BLOCKER_RE = /SECURITY|LEAKED|SECRET|CREDENTIAL|TOKEN|KEY|PASSWORD/i;
const HIGH_RE = /BUG|ARCHITECTURE|CRASH|NULL|UNDEFINED|RACE.CONDITION/i;
const MEDIUM_RE = /HARDCODED|COMMITTED|TRACKED|DEAD.CODE|UNUSED/i;
const FILE_RE = /`([^`]+\.(?:swift|ts|py|js|tsx|json))[:`]?(\d+)?`/;

function classifySeverity(text: string): ParsedConcern['severity'] {
  if (BLOCKER_RE.test(text)) return 'blocker';
  if (HIGH_RE.test(text)) return 'high';
  if (MEDIUM_RE.test(text)) return 'medium';
  return 'low';
}

export function parseReviewConcerns(rawOutput: string): ParsedConcern[] {
  const concernsMatch = rawOutput.match(/CONCERNS:\n([\s\S]*?)(?=SUGGESTIONS:|$)/);
  if (!concernsMatch) return [];

  const bullets = concernsMatch[1]
    .split('\n')
    .map(l => l.replace(/^-\s*/, '').trim())
    .filter(l => l && l !== 'none');

  return bullets.map(bullet => {
    const severity = classifySeverity(bullet);
    const fileMatch = bullet.match(FILE_RE);
    const file = fileMatch?.[1];
    const line = fileMatch?.[2] ? parseInt(fileMatch[2], 10) : undefined;
    const fixInstruction = file
      ? `Fix: ${bullet}. File: ${file}${line ? `:${line}` : ''}`
      : `Fix: ${bullet}`;

    return {
      severity,
      title: bullet.slice(0, 80),
      detail: bullet,
      file,
      line,
      fixInstruction,
    };
  });
}

/** Strip markdown formatting from bead titles to prevent bd CLI parsing issues. */
function sanitizeBeadTitle(title: string): string {
  const cleaned = title
    .replace(/\*\*/g, '')                       // remove bold markers
    .replace(/`/g, '')                           // remove backticks
    .replace(/"/g, '\\"')                        // escape double quotes
    .replace(/'/g, "\\'")                        // escape single quotes
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')    // markdown links → text
    .replace(/[#>]/g, '')                        // remove heading/quote markers
    .trim()
    .slice(0, 80);                               // enforce max length
  return cleaned || 'untitled-fix';
}

export async function createFixBeads(
  concerns: ParsedConcern[],
  projectPath: string,
  sourceBatchId: string
): Promise<string[]> {
  const BD = `${process.env.HOME}/.local/bin/bd`;
  const actionable = concerns.filter(c => c.severity !== 'low');
  const createdIds: string[] = [];

  for (const concern of actionable) {
    const priority = concern.severity === 'blocker' ? 1 : 2;
    const safeTitle = sanitizeBeadTitle(concern.title);

    // Build description with full concern context for fix cycle prompt
    const descLines = [
      concern.detail,
      concern.file ? `File: ${concern.file}${concern.line ? `:${concern.line}` : ''}` : '',
      concern.fixInstruction,
    ].filter(Boolean);
    const safeDesc = descLines.join('\\n').replace(/"/g, '\\"').slice(0, 500);

    try {
      const result = await shellExec(
        `${BD} create "fix: ${safeTitle}" -t task -p ${priority} -d "${safeDesc}" --label fix --label ${sourceBatchId} --label ${concern.severity} --json`,
        { cwd: projectPath }
      );
      if (result.exitCode === 0 && result.stdout.trim()) {
        const parsed = JSON.parse(result.stdout);
        const id = Array.isArray(parsed) ? parsed[0]?.id : parsed?.id;
        if (id) {
          createdIds.push(id);
        } else {
          console.error(`[createFixBeads] bd returned OK but no id in output: ${result.stdout.slice(0, 200)}`);
        }
      } else {
        console.error(`[createFixBeads] bd create failed (exit ${result.exitCode}): ${result.stderr.slice(0, 200)}`);
      }
    } catch (err) {
      console.error(`[createFixBeads] Exception creating bead for "${safeTitle}":`, err);
    }
  }

  return createdIds;
}
