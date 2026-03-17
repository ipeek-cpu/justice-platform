import { exec } from 'child_process';
import { promisify } from 'util';
import { notionLogger } from '../integrations/notion-logger';
import { sendIMessage } from '@justice/messaging';
import { runPhase } from './code-executor';

const execAsync = promisify(exec);
const ISAIAH = process.env.APPROVED_NUMBER_ISAIAH!;

export interface ReviewResult {
  status: 'APPROVED' | 'NEEDS_CHANGES' | 'BLOCKED';
  concerns: string[];
  suggestions: string[];
  readyForHumanReview: boolean;
  rawOutput: string;
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

  const reviewPrompt = `
You are a senior code reviewer for an iOS/TypeScript project.
Review the changes on branch ${currentBranch.trim()} against ${baseBranch}.

Spec summary:
${specSummary}

Diff statistics:
${diffStat}

Get the full diff with:
git -C ${projectPath} diff ${baseBranch}...HEAD

Review checklist:
- Does the implementation match the spec?
- Are there obvious bugs or unhandled edge cases?
- Are there hardcoded values that should be env vars or constants?
- Is error handling present on all async calls?
- Any security concerns (exposed secrets, weak auth, insecure storage)?
- Does the build pass? Run: xcodebuild build -scheme HLSTC -destination 'platform=iOS Simulator,name=iPhone 16' CODE_SIGNING_ALLOWED=NO 2>&1 | tail -5
- Are there any unresolved TODOs or FIXMEs?
- Does the code follow existing patterns in the codebase?

Output EXACTLY in this format (no other text):
STATUS: APPROVED | NEEDS_CHANGES | BLOCKED
CONCERNS:
- concern 1 (or "none")
- concern 2
SUGGESTIONS:
- suggestion 1 (or "none")
READY_FOR_HUMAN_REVIEW: YES | NO
SUMMARY: one sentence summary of what was built
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
