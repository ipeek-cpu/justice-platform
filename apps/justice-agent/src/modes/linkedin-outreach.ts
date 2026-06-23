import { getClient } from '../integrations/notion-client';
import { notionLogger } from '../integrations/notion-logger';
import { sendGuardedIMessage } from '../nudge/send-guard';
import { updateState } from '../cron/proactive-agent';

const ISAIAH = process.env.APPROVED_NUMBER_ISAIAH!;

export interface RecruiterTarget {
  name: string;
  title: string;
  company: string;
  connectionAngle: string;
}

export interface OutreachDraft {
  target: RecruiterTarget;
  messageBody: string;
  characterCount: number;
  messageType: 'connection_request' | 'inmail';
}

// Draft a batch of LinkedIn messages
// Called when Isaiah requests outreach via iMessage
export async function draftOutreachBatch(
  targets: RecruiterTarget[],
  context: string  // e.g. "senior data engineering roles in Chicago"
): Promise<void> {

  const drafts: OutreachDraft[] = targets.map(target => {
    const body = buildMessage(target, context);
    return {
      target,
      messageBody: body,
      characterCount: body.length,
      messageType: body.length <= 300 ? 'connection_request' : 'inmail',
    };
  });

  // Create Notion page with all drafts
  const pageId = await notionLogger.createTaskPage(
    `LinkedIn Outreach Batch — ${new Date().toISOString().split('T')[0]}`,
    `${drafts.length} recruiter messages drafted for: ${context}`
  );

  // Log each draft to Notion
  for (const draft of drafts) {
    await logDraftToNotion(pageId, draft);
  }

  // Update state for proactive tracking
  updateState('lastLinkedInOutreachDate', new Date().toISOString());

  // Ping Isaiah
  const link = notionLogger.pageUrl(pageId);
  await sendGuardedIMessage(
    ISAIAH,
    `${drafts.length} LinkedIn draft(s) ready — Check Notion: ${link}\n\nReview and send manually.`
  );
}

async function logDraftToNotion(pageId: string, draft: OutreachDraft): Promise<void> {
  try {
    const notion = getClient();

    await notion.blocks.children.append({
      block_id: pageId,
      children: [
        {
          object: 'block' as const,
          type: 'heading_3' as const,
          heading_3: {
            rich_text: [{ type: 'text' as const, text: { content: `${draft.target.name} — ${draft.target.title} at ${draft.target.company}` } }]
          }
        },
        {
          object: 'block' as const,
          type: 'callout' as const,
          callout: {
            rich_text: [{ type: 'text' as const, text: { content: `Connection angle: ${draft.target.connectionAngle}` } }],
            icon: { type: 'emoji' as const, emoji: '\uD83C\uDFAF' },
            color: 'blue_background' as const
          }
        },
        {
          object: 'block' as const,
          type: 'code' as const,
          code: {
            rich_text: [{ type: 'text' as const, text: { content: draft.messageBody } }],
            language: 'plain text' as const
          }
        },
        {
          object: 'block' as const,
          type: 'paragraph' as const,
          paragraph: {
            rich_text: [{
              type: 'text' as const,
              text: {
                content: `${draft.characterCount} chars — ${draft.messageType === 'connection_request' ? 'Connection request' : 'InMail (over 300 chars)'}`
              }
            }]
          }
        },
        { object: 'block' as const, type: 'divider' as const, divider: {} }
      ]
    });
  } catch (err) {
    console.error('[linkedin-outreach] logDraftToNotion failed:', err);
  }
}

function buildMessage(target: RecruiterTarget, context: string): string {
  // Concise, personalized connection request
  return `Hi ${target.name.split(' ')[0]}, I'm a senior data engineer in Chicago exploring ${context}. ${target.connectionAngle} Would love to connect.`;
}
