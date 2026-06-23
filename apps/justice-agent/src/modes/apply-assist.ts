/**
 * Apply-Assist — turns a scored job shortlist into reviewed outreach.
 *
 * Hard rule: this NEVER submits an application and never sends a LinkedIn
 * message. It surfaces the role requirements, gates on the Redis approval-gate,
 * and — only on an explicit YES — drafts outreach via
 * linkedin-outreach.draftOutreachBatch (which logs drafts to Notion and pings
 * Isaiah to send manually). Isaiah reviews and sends everything himself.
 *
 * Reuses existing rails:
 *   - approval-gate (createApproval / getApproval) + the poll pattern from code-executor
 *   - linkedin-outreach.draftOutreachBatch for the reach-out path
 */

import { createApproval, getApproval, formatStamp } from '../integrations/approval-gate';
import { sendGuardedIMessage } from '../nudge/send-guard';
import { draftOutreachBatch, type RecruiterTarget } from './linkedin-outreach';
import type { ScoredJob } from './job-discovery';
import type { Lane } from '../config/target-companies';

const ISAIAH = process.env.APPROVED_NUMBER_ISAIAH;
const SESSION = process.env.JUSTICE_SESSION_ID ?? 'job-discovery';

export interface ApplyAssistOptions {
  /** Max roles to shortlist. Default 5. */
  topN?: number;
  /** Minimum fit score to qualify. Default 70. */
  minScore?: number;
  /** Optional lane filter (e.g. only "stable-FT"). */
  lane?: Lane;
}

/** Pick the outreach shortlist from scored jobs. */
export function buildShortlist(jobs: ScoredJob[], opts: ApplyAssistOptions = {}): ScoredJob[] {
  const { topN = 5, minScore = 70, lane } = opts;
  return jobs
    .filter((j) => j.fitScore >= minScore && (!lane || j.lane === lane))
    .sort((a, b) => b.fitScore - a.fitScore)
    .slice(0, topN);
}

/** Human-readable requirements brief for the shortlist (the "surface reqs" step). */
function formatRequirements(shortlist: ScoredJob[]): string {
  const lines = shortlist.map((j, i) => {
    const comp = j.comp ? ` | ${j.comp}` : '';
    const stack = j.stack.length ? `\n   stack: ${j.stack.slice(0, 8).join(', ')}` : '';
    return `${i + 1}. [${j.fitScore}] ${j.role} — ${j.company} (${j.lane}, ${j.employmentType})${comp}${stack}\n   ${j.whyItFits}\n   ${j.link}`;
  });
  return lines.join('\n\n');
}

/** Map shortlisted roles to outreach targets for the reach-out path. */
function toRecruiterTargets(shortlist: ScoredJob[]): RecruiterTarget[] {
  // No recruiter is identified automatically — Isaiah swaps in the real contact
  // before sending. The role-specific angle is what makes each draft useful.
  return shortlist.map((j) => ({
    name: 'there',
    title: 'Recruiter / Hiring Manager',
    company: j.company,
    connectionAngle: `Your ${j.role} opening lines up closely with my background — ${j.whyItFits}`,
  }));
}

/**
 * Surface the shortlist's requirements, ask for approval, and — only on YES —
 * draft outreach for review. Returns whether outreach was drafted.
 *
 * Set `autoWait: false` to fire-and-return after pinging (the inbound approval
 * handler can later call `executeApprovedOutreach`); default polls for the reply.
 */
export async function runApplyAssist(
  jobs: ScoredJob[],
  context: string,
  opts: ApplyAssistOptions & { autoWait?: boolean } = {},
): Promise<{ shortlist: ScoredJob[]; drafted: boolean; approvalId?: string }> {
  const shortlist = buildShortlist(jobs, opts);

  if (shortlist.length === 0) {
    if (ISAIAH) await sendGuardedIMessage(ISAIAH, `Apply-assist: no roles cleared the bar (min score ${opts.minScore ?? 70}).`);
    return { shortlist, drafted: false };
  }

  const question = `Draft LinkedIn outreach for ${shortlist.length} shortlisted role(s) (${context})?`;
  const stamp = await createApproval(SESSION, question, ISAIAH);

  if (ISAIAH) {
    await sendGuardedIMessage(
      ISAIAH,
      `Apply-assist shortlist — requirements:\n\n${formatRequirements(shortlist)}\n\n` +
        `${formatStamp(stamp)} ${question}\nReply "yes ${stamp}" to draft outreach (you review + send), or "no ${stamp}".`,
    );
  }

  if (opts.autoWait === false) {
    return { shortlist, drafted: false, approvalId: stamp };
  }

  const approved = await waitForApproval(stamp, question);
  if (!approved) {
    console.log(`[apply-assist] Outreach not approved (${stamp})`);
    return { shortlist, drafted: false, approvalId: stamp };
  }

  await draftOutreachBatch(toRecruiterTargets(shortlist), context);
  return { shortlist, drafted: true, approvalId: stamp };
}

/**
 * Draft outreach for a previously-surfaced shortlist once its approval is YES.
 * For use by an inbound approval handler when runApplyAssist was called with
 * autoWait: false. No-op unless the approval has been resolved YES.
 */
export async function executeApprovedOutreach(
  approvalId: string,
  shortlist: ScoredJob[],
  context: string,
): Promise<boolean> {
  const approval = await getApproval(approvalId);
  if (approval?.status !== 'YES') return false;
  await draftOutreachBatch(toRecruiterTargets(shortlist), context);
  return true;
}

/** Poll the approval-gate until resolved (mirrors code-executor's pattern). */
function waitForApproval(stamp: string, question: string): Promise<boolean> {
  return new Promise((resolve) => {
    let lastPing = Date.now();
    const REPING_MS = 6 * 60 * 60 * 1000;
    const poll = setInterval(async () => {
      try {
        const approval = await getApproval(stamp);
        if (!approval) {
          clearInterval(poll);
          resolve(false);
          return;
        }
        if (approval.status === 'YES') {
          clearInterval(poll);
          resolve(true);
        } else if (approval.status === 'NO') {
          clearInterval(poll);
          resolve(false);
        } else if (Date.now() - lastPing > REPING_MS) {
          if (ISAIAH) {
            await sendGuardedIMessage(ISAIAH, `Reminder: ${question} ${formatStamp(stamp)}\nReply "yes ${stamp}" or "no ${stamp}".`);
          }
          lastPing = Date.now();
        }
      } catch {
        /* Redis error — keep polling */
      }
    }, 5000);
  });
}
