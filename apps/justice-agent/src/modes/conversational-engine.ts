/**
 * Conversational Engine — Replaces intent-parser + action-executor.
 *
 * Single Claude API call with tool_use. The model decides which tools to call
 * and the engine executes them in a loop (max 5 rounds).
 *
 * Tools: query_case_metrics, query_case, create_task, list_tasks, complete_task,
 *        draft_email, confirm_send_email, schedule_meeting, check_calendar, get_status_briefing
 */

import { getCaseMetrics, getCaseBySessionId, createTask, getTasksByAssignee, completeTask, logAuditEntry } from '../db/queries';
import { searchNotion, readNotionPage, createNotionPage, appendToNotionPage, queryNotionDatabase } from '../integrations/notion-client';
import { getCalendarEvents, createCalendarEvent, sendGmail, hasGoogleAuth, getConnectedAccounts } from '../integrations/google-workspace';
import { configureNudge, getNudgeState } from '../nudge/task-nudger';
import { runMorningBrief, getMorningBriefState, setMorningBriefEnabled } from '../nudge/morning-brief';
import { appendToMemory } from '../memory/session-logger';
import { draftOutreachBatch } from './linkedin-outreach';
import { getProject, listProjects } from '../registry/ios-projects';
import { execSync } from 'child_process';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string | ToolUseContent[];
  timestamp: string;
}

interface ToolUseContent {
  type: 'tool_use' | 'tool_result' | 'text';
  tool_use_id?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string;
  text?: string;
}

// Pending email drafts keyed by callerIdentity
const pendingEmails = new Map<string, { to: string[]; subject: string; body: string; fromAccount?: string; draftedAt: string }>();

const TOOL_DEFINITIONS = [
  {
    name: 'query_case_metrics',
    description: 'Get aggregate case metrics: total count, today count, breakdown by status and category.',
    input_schema: { type: 'object' as const, properties: {}, required: [] as string[] },
  },
  {
    name: 'query_case',
    description: 'Look up a specific case by its session ID.',
    input_schema: {
      type: 'object' as const,
      properties: { session_id: { type: 'string', description: 'The session ID of the case to look up' } },
      required: ['session_id'],
    },
  },
  {
    name: 'create_task',
    description: 'Create a new task in the task tracker.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Task title' },
        assignee: { type: 'string', enum: ['isaiah', 'scott'], description: 'Who to assign the task to' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Task priority' },
        deadline: { type: 'string', description: 'Deadline as ISO date string (optional)' },
      },
      required: ['title'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List tasks, optionally filtered by assignee and status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        assignee: { type: 'string', description: 'Filter by assignee (isaiah or scott)' },
        filter: { type: 'string', enum: ['all', 'pending', 'completed', 'overdue', 'today'], description: 'Status filter' },
      },
      required: [],
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task as completed by its ID (or first 8 chars of ID).',
    input_schema: {
      type: 'object' as const,
      properties: { task_id: { type: 'string', description: 'Task ID or short ID (first 8 chars)' } },
      required: ['task_id'],
    },
  },
  {
    name: 'draft_email',
    description: 'Draft an email for review. The email will NOT be sent until confirm_send_email is called. Always use this before sending any email.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to: { type: 'array', items: { type: 'string' }, description: 'Recipient email addresses' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body text' },
        from_account: { type: 'string', description: 'Google account email to send from — omit to use primary account' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'confirm_send_email',
    description: 'Send a previously drafted email. Only call this after the user has explicitly confirmed they want to send.',
    input_schema: {
      type: 'object' as const,
      properties: {
        confirmed: { type: 'boolean', description: 'Whether the user confirmed sending' },
        from_account: { type: 'string', description: 'Override the from account set at draft time (optional)' },
      },
      required: ['confirmed'],
    },
  },
  {
    name: 'schedule_meeting',
    description: 'Schedule a meeting or call. Currently returns confirmation that the meeting is logged (Google Calendar integration pending).',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Meeting title' },
        attendees: { type: 'array', items: { type: 'string' }, description: 'Attendee names or emails' },
        proposed_time: { type: 'string', description: 'Proposed time for the meeting' },
        duration: { type: 'string', description: 'Meeting duration (e.g., "30 min", "1 hour")' },
        notes: { type: 'string', description: 'Additional notes' },
      },
      required: ['title', 'attendees'],
    },
  },
  {
    name: 'check_calendar',
    description: 'Check the calendar for a given date range. (Google Calendar integration pending)',
    input_schema: {
      type: 'object' as const,
      properties: {
        range: { type: 'string', enum: ['today', 'tomorrow', 'this_week', 'next_week'], description: 'Date range to check' },
        date: { type: 'string', description: 'Specific date in YYYY-MM-DD format' },
      },
      required: [],
    },
  },
  {
    name: 'get_status_briefing',
    description: 'Get a status briefing including case metrics and pending tasks for the caller.',
    input_schema: {
      type: 'object' as const,
      properties: {
        topic: { type: 'string', enum: ['cases', 'pipeline', 'attorneys', 'general'], description: 'Topic focus for the briefing' },
      },
      required: [],
    },
  },
  {
    name: 'search_notion',
    description: 'Search across the Wronged.AI Notion workspace for pages matching a query.',
    input_schema: {
      type: 'object' as const,
      properties: { query: { type: 'string', description: 'Search query' } },
      required: ['query'],
    },
  },
  {
    name: 'read_notion_page',
    description: 'Read the full content of a Notion page by its ID.',
    input_schema: {
      type: 'object' as const,
      properties: { page_id: { type: 'string', description: 'Notion page ID' } },
      required: ['page_id'],
    },
  },
  {
    name: 'create_notion_page',
    description: 'Create a new page in the Notion workspace. Defaults to creating under the main Wronged.AI page if no parent specified.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Page title' },
        content: { type: 'string', description: 'Page content (plain text, newlines become separate paragraphs)' },
        parent_page_id: { type: 'string', description: 'Parent page ID (optional — defaults to main workspace page)' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'append_to_notion_page',
    description: 'Append content to an existing Notion page.',
    input_schema: {
      type: 'object' as const,
      properties: {
        page_id: { type: 'string', description: 'Notion page ID to append to' },
        content: { type: 'string', description: 'Content to append (newlines become separate paragraphs)' },
      },
      required: ['page_id', 'content'],
    },
  },
  {
    name: 'query_notion_database',
    description: 'Query a Notion database with optional filters. Returns rows with their properties.',
    input_schema: {
      type: 'object' as const,
      properties: {
        database_id: { type: 'string', description: 'Notion database ID' },
        filter: { type: 'object', description: 'Notion filter object (optional)' },
      },
      required: ['database_id'],
    },
  },
  {
    name: 'configure_nudges',
    description: 'Configure proactive task nudge reminders sent via iMessage. Pause, resume, snooze, or check status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', enum: ['status', 'pause', 'resume', 'snooze'], description: 'What to do with nudges' },
        snooze_hours: { type: 'number', description: 'Hours to snooze (only used with snooze action, default 2)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'morning_brief',
    description: 'Control the daily morning briefing. Check status, send immediately, or enable/disable.',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', enum: ['status', 'send_now', 'disable', 'enable'], description: 'What to do with morning briefs' },
      },
      required: ['action'],
    },
  },
  {
    name: 'linkedin_draft_batch',
    description: 'Draft personalized LinkedIn outreach messages for a batch of targets. Drafts are logged to Notion for review — never sent directly.',
    input_schema: {
      type: 'object' as const,
      properties: {
        context: { type: 'string', description: 'What kind of roles/outreach, e.g. "senior data engineering roles in Chicago"' },
        targets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              title: { type: 'string' },
              company: { type: 'string' },
              connection_angle: { type: 'string' },
            },
            required: ['name', 'title', 'company', 'connection_angle'],
          },
          description: 'List of LinkedIn targets to draft messages for',
        },
      },
      required: ['context', 'targets'],
    },
  },
  {
    name: 'memory_log',
    description: 'Log an important fact to long-term memory (MEMORY.md). Use for decisions, preferences, or context that should persist across sessions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        fact: { type: 'string', description: 'The fact to remember' },
      },
      required: ['fact'],
    },
  },
  {
    name: 'status_check',
    description: 'Get current task status from beads (bd ready). Shows what needs attention right now.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: 'code_execute',
    description: 'Queue an autonomous code execution task. Runs in phases with Claude Code CLI, logs to Notion, and requires approval between phases.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_name: { type: 'string', description: 'Name of the coding task' },
        spec: { type: 'string', description: 'Detailed specification of what to build' },
      },
      required: ['task_name', 'spec'],
    },
  },
  {
    name: 'ios_task',
    description: 'List registered iOS projects or get details about a specific project.',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', enum: ['list', 'get'], description: 'List all projects or get a specific one' },
        project_id: { type: 'string', description: 'Project ID (required for get action)' },
      },
      required: ['action'],
    },
  },
];

async function buildSystemPrompt(callerIdentity: string, currentDate: string): Promise<string> {
  let accountsSection = '';
  try {
    const accounts = await getConnectedAccounts(callerIdentity);
    if (accounts.length > 0) {
      const accountLines = accounts.map(a => `  - ${a.email}${a.isPrimary ? ' (primary)' : ''}`).join('\n');
      accountsSection = `\nConnected Google accounts:\n${accountLines}\n`;
    }
  } catch {
    // No accounts connected yet
  }

  return `You are Justice, the executive assistant for Wolf Law and the internal platform.
You help ${callerIdentity} with operations, calendar, email, tasks, case analysis, and Notion.
- Notion: Search pages, read content, create new pages, update existing pages, query databases in the workspace

${currentDate}
${accountsSection}
Rules:
- NEVER send an email without drafting first (use draft_email) and waiting for explicit confirmation (use confirm_send_email).
- Always confirm before scheduling on another person's calendar.
- Never share case data with unauthorized parties.
- Never make legal recommendations.
- Log all actions for audit trail.
- Be concise in responses — this is a text/iMessage conversation.
- Calendar checks show events from ALL connected Google accounts.
- Default to the primary (@wolflaw.ai) account for creating calendar events and sending email.
- If the user references a personal context or asks to send from a specific account, use the matching from_account.
- Do NOT ask which account to use unless the context is ambiguous — infer from the conversation.

Nudges: I proactively remind you about upcoming and overdue tasks via iMessage. You can pause, snooze, or check nudge status.
- Morning brief: I send you a daily briefing at 8 AM with tasks, deadlines, and case updates. You can ask me to send one now, or disable/enable them.

Available actions: query case metrics, look up cases, create/list/complete tasks, draft and send emails, schedule meetings, check calendar, provide status briefings, search/read/create/update Notion pages, configure task nudges, manage morning briefs, draft LinkedIn outreach (logged to Notion, never sent directly), log facts to long-term memory, check beads task status, queue autonomous code execution tasks, and manage iOS project registry.`;
}

async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  callerIdentity: string
): Promise<string> {
  switch (toolName) {
    case 'query_case_metrics': {
      const metrics = await getCaseMetrics();
      const statusLines = metrics.byStatus.map(s => `${s.status}: ${s.count}`).join(', ');
      const categoryLines = metrics.byCategory
        .filter(c => c.category)
        .map(c => `${c.category}: ${c.count}`).join(', ');
      return JSON.stringify({
        total: metrics.total,
        today: metrics.today,
        by_status: statusLines || 'none',
        by_category: categoryLines || 'none',
      });
    }

    case 'query_case': {
      const sessionId = input.session_id as string;
      const caseRow = await getCaseBySessionId(sessionId);
      if (!caseRow) return JSON.stringify({ error: `No case found for session ${sessionId}` });
      return JSON.stringify({
        session_id: caseRow.sessionId,
        status: caseRow.status,
        category: caseRow.category,
        score: caseRow.caseScore,
        summary: caseRow.summary,
        created_at: caseRow.createdAt.toISOString(),
      });
    }

    case 'create_task': {
      const task = await createTask({
        title: input.title as string,
        assignee: (input.assignee as string) ?? callerIdentity,
        priority: input.priority as string,
        deadline: input.deadline ? new Date(input.deadline as string) : undefined,
        createdBy: callerIdentity,
      });
      return JSON.stringify({
        id: task.id.slice(0, 8),
        title: task.title,
        assignee: task.assignee,
        priority: task.priority,
        deadline: task.deadline?.toISOString() ?? null,
      });
    }

    case 'list_tasks': {
      const assignee = (input.assignee as string) ?? callerIdentity;
      const filter = input.filter as string | undefined;
      const taskRows = await getTasksByAssignee(assignee, filter);
      if (taskRows.length === 0) return JSON.stringify({ tasks: [], message: `No tasks found for ${assignee}` });
      return JSON.stringify({
        tasks: taskRows.map(t => ({
          id: t.id.slice(0, 8),
          title: t.title,
          status: t.status,
          priority: t.priority,
          deadline: t.deadline?.toISOString() ?? null,
        })),
      });
    }

    case 'complete_task': {
      const taskId = input.task_id as string;
      const updated = await completeTask(taskId);
      if (!updated) return JSON.stringify({ error: `Task ${taskId} not found` });
      return JSON.stringify({ success: true, task_id: updated.id.slice(0, 8), title: updated.title });
    }

    case 'draft_email': {
      const draft = {
        to: input.to as string[],
        subject: input.subject as string,
        body: input.body as string,
        fromAccount: input.from_account as string | undefined,
        draftedAt: new Date().toISOString(),
      };
      pendingEmails.set(callerIdentity, draft);
      return JSON.stringify({
        status: 'drafted',
        to: draft.to,
        subject: draft.subject,
        body: draft.body,
        from_account: draft.fromAccount ?? 'primary',
        message: 'Email drafted. Ask the user to confirm before sending.',
      });
    }

    case 'confirm_send_email': {
      const confirmed = input.confirmed as boolean;
      const draft = pendingEmails.get(callerIdentity);
      if (!draft) return JSON.stringify({ error: 'No pending email draft to send.' });
      pendingEmails.delete(callerIdentity);
      if (!confirmed) return JSON.stringify({ status: 'cancelled', message: 'Email cancelled.' });

      const hasAuth = await hasGoogleAuth(callerIdentity);
      if (!hasAuth) {
        return JSON.stringify({ status: 'error', error: `Gmail not connected for ${callerIdentity} — visit /api/oauth/google/authorize?user=${callerIdentity}` });
      }
      const fromAccount = (input.from_account as string) ?? draft.fromAccount;
      const sendResult = await sendGmail(callerIdentity, draft.to, draft.subject, draft.body, fromAccount);
      if ('error' in sendResult) return JSON.stringify({ status: 'error', error: sendResult.error });
      return JSON.stringify({ status: 'sent', message_id: sendResult.messageId, sent_from: sendResult.sentFrom, to: draft.to, subject: draft.subject });
    }

    case 'schedule_meeting': {
      const hasAuth = await hasGoogleAuth(callerIdentity);
      if (!hasAuth) {
        return JSON.stringify({ status: 'logged_only', title: input.title, message: `Calendar not connected for ${callerIdentity} — visit /api/oauth/google/authorize?user=${callerIdentity}` });
      }

      const proposedTime = input.proposed_time as string | undefined;
      if (!proposedTime) {
        return JSON.stringify({ status: 'need_time', message: 'When should the meeting be? Provide a date and time.' });
      }

      // Parse duration (default 30 min)
      const durationStr = (input.duration as string) ?? '30 min';
      const durationMinutes = parseInt(durationStr) || 30;
      const startTime = new Date(proposedTime).toISOString();
      const endTime = new Date(new Date(proposedTime).getTime() + durationMinutes * 60 * 1000).toISOString();

      const result = await createCalendarEvent(callerIdentity, {
        title: input.title as string,
        attendees: (input.attendees as string[]) ?? [],
        startTime,
        endTime,
        notes: input.notes as string | undefined,
      });

      if ('error' in result) return JSON.stringify({ status: 'error', error: result.error });
      return JSON.stringify({ status: 'scheduled', event_id: result.id, link: result.link });
    }

    case 'check_calendar': {
      const hasAuth = await hasGoogleAuth(callerIdentity);
      if (!hasAuth) {
        return JSON.stringify({ error: `Calendar not connected for ${callerIdentity} — visit /api/oauth/google/authorize?user=${callerIdentity}` });
      }

      const range = (input.range as string) ?? 'today';
      const now = new Date();
      let timeMin: Date;
      let timeMax: Date;

      switch (range) {
        case 'tomorrow':
          timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
          timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
          break;
        case 'this_week': {
          const dayOfWeek = now.getDay();
          timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
          timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (7 - dayOfWeek));
          break;
        }
        case 'next_week': {
          const dow = now.getDay();
          timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (7 - dow));
          timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (14 - dow));
          break;
        }
        default: // 'today' or specific date
          if (input.date) {
            timeMin = new Date(input.date as string);
            timeMax = new Date(timeMin.getTime() + 24 * 60 * 60 * 1000);
          } else {
            timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
          }
      }

      const result = await getCalendarEvents(callerIdentity, timeMin.toISOString(), timeMax.toISOString());
      if ('error' in result) return JSON.stringify({ error: result.error });
      return JSON.stringify({ range, events: result.events });
    }

    case 'get_status_briefing': {
      const metrics = await getCaseMetrics();
      const myTasks = await getTasksByAssignee(callerIdentity, 'pending');
      const statusLines = metrics.byStatus.map(s => `${s.status}: ${s.count}`).join(', ');
      return JSON.stringify({
        cases_total: metrics.total,
        cases_today: metrics.today,
        pipeline: statusLines || 'none',
        pending_tasks: myTasks.length,
        top_tasks: myTasks.slice(0, 5).map(t => ({ title: t.title, priority: t.priority })),
      });
    }

    case 'search_notion': {
      const result = await searchNotion(input.query as string);
      return JSON.stringify(result);
    }

    case 'read_notion_page': {
      const result = await readNotionPage(input.page_id as string);
      return JSON.stringify(result);
    }

    case 'create_notion_page': {
      const parentId = (input.parent_page_id as string) ?? process.env.NOTION_WRONGEDAI_PAGE_ID;
      if (!parentId) return JSON.stringify({ error: 'No parent page ID — set NOTION_WRONGEDAI_PAGE_ID env var' });
      const result = await createNotionPage(parentId, input.title as string, input.content as string);
      return JSON.stringify(result);
    }

    case 'append_to_notion_page': {
      const result = await appendToNotionPage(input.page_id as string, input.content as string);
      return JSON.stringify(result);
    }

    case 'query_notion_database': {
      const result = await queryNotionDatabase(input.database_id as string, input.filter as Record<string, unknown> | undefined);
      return JSON.stringify(result);
    }

    case 'configure_nudges': {
      const action = input.action as string;
      if (action === 'status') {
        return JSON.stringify(getNudgeState());
      }
      const message = configureNudge(action, input.snooze_hours as number | undefined);
      return JSON.stringify({ action, message });
    }

    case 'morning_brief': {
      const action = input.action as string;
      switch (action) {
        case 'status':
          return JSON.stringify(getMorningBriefState());
        case 'send_now':
          await runMorningBrief(true);
          return JSON.stringify({ message: 'Morning brief sent.' });
        case 'disable':
          setMorningBriefEnabled(false);
          return JSON.stringify({ message: 'Morning briefs disabled.' });
        case 'enable':
          setMorningBriefEnabled(true);
          return JSON.stringify({ message: 'Morning briefs enabled.' });
        default:
          return JSON.stringify({ error: `Unknown morning_brief action: ${action}` });
      }
    }

    case 'linkedin_draft_batch': {
      const context = input.context as string;
      const targets = (input.targets as Array<{ name: string; title: string; company: string; connection_angle: string }>)
        .map(t => ({ name: t.name, title: t.title, company: t.company, connectionAngle: t.connection_angle }));
      await draftOutreachBatch(targets, context);
      return JSON.stringify({ success: true, drafts: targets.length, message: 'Drafts logged to Notion. Isaiah pinged via iMessage.' });
    }

    case 'memory_log': {
      const fact = input.fact as string;
      appendToMemory(fact);
      return JSON.stringify({ success: true, message: `Logged to memory: ${fact}` });
    }

    case 'status_check': {
      try {
        const stdout = execSync(`${process.env.HOME}/.local/bin/bd ready`, { encoding: 'utf8', timeout: 5000 });
        return JSON.stringify({ status: stdout.trim() || 'No unblocked tasks.' });
      } catch {
        return JSON.stringify({ status: 'bd ready failed or no tasks.' });
      }
    }

    case 'code_execute': {
      const taskName = input.task_name as string;
      return JSON.stringify({ status: 'queued', task: taskName, message: 'Code execution tasks run asynchronously. Check Notion for progress.' });
    }

    case 'ios_task': {
      const action = input.action as string;
      if (action === 'list') {
        const projects = listProjects();
        if (projects.length === 0) return JSON.stringify({ projects: [], message: 'No iOS projects registered yet.' });
        return JSON.stringify({ projects: projects.map(p => ({ id: p.id, name: p.name, stack: p.stack })) });
      }
      if (action === 'get') {
        const project = getProject(input.project_id as string);
        if (!project) return JSON.stringify({ error: `Project not found: ${input.project_id}` });
        return JSON.stringify(project);
      }
      return JSON.stringify({ error: `Unknown ios_task action: ${action}` });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

export async function handleMessage(
  phoneNumber: string,
  messageText: string,
  callerIdentity: string,
  conversationHistory: ConversationMessage[]
): Promise<{ response: string; updatedHistory: ConversationMessage[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { response: 'Claude API not configured — set ANTHROPIC_API_KEY.', updatedHistory: conversationHistory };
  }

  const model = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-20250514';
  const TZ = 'America/Chicago';
  const now = new Date();

  // Today and tomorrow in CT
  const todayISO = now.toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
  const todayDow = now.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long' });
  const tomorrowDate = new Date(now.getTime() + 86_400_000);
  const tomorrowISO = tomorrowDate.toLocaleDateString('en-CA', { timeZone: TZ });
  const tomorrowDow = tomorrowDate.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long' });

  // Next Monday (1) and Friday (5) — always the NEXT occurrence, never today
  const ctNoon = new Date(todayISO + 'T12:00:00');
  const dow = ctNoon.getDay();
  const daysToMonday = ((1 - dow + 7) % 7) || 7;
  const daysToFriday = ((5 - dow + 7) % 7) || 7;
  const nextMondayISO = new Date(ctNoon.getTime() + daysToMonday * 86_400_000).toLocaleDateString('en-CA');
  const nextFridayISO = new Date(ctNoon.getTime() + daysToFriday * 86_400_000).toLocaleDateString('en-CA');

  const dateContext = [
    `Current date: ${todayISO}`,
    `Day of week: ${todayDow}`,
    `Tomorrow: ${tomorrowDow}, ${tomorrowISO}`,
    `This coming Monday: ${nextMondayISO}`,
    `This coming Friday: ${nextFridayISO}`,
  ].join('\n');

  const systemPrompt = await buildSystemPrompt(callerIdentity, dateContext);

  // Build API messages from conversation history
  const apiMessages: Array<{ role: string; content: unknown }> = conversationHistory.map(msg => ({
    role: msg.role,
    content: msg.content,
  }));

  // Add the new user message
  apiMessages.push({ role: 'user', content: messageText });

  let finalText = '';
  let rounds = 0;
  const MAX_ROUNDS = 5;

  while (rounds < MAX_ROUNDS) {
    rounds++;

    let data: Record<string, unknown>;
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          system: systemPrompt,
          tools: TOOL_DEFINITIONS,
          messages: apiMessages,
        }),
      });

      if (!response.ok) {
        console.error(`[conversational-engine] Claude API error: ${response.status}`);
        return { response: 'Failed to reach Claude API. Try again in a moment.', updatedHistory: conversationHistory };
      }

      data = await response.json() as Record<string, unknown>;
    } catch (error) {
      console.error('[conversational-engine] Claude API request failed:', error);
      return { response: 'Failed to reach Claude API. Try again in a moment.', updatedHistory: conversationHistory };
    }

    const content = data.content as Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
    const stopReason = data.stop_reason as string;

    // Extract any text blocks
    const textBlocks = content.filter(b => b.type === 'text');
    if (textBlocks.length > 0) {
      finalText = textBlocks.map(b => b.text).join('');
    }

    // If no tool use, we're done
    if (stopReason !== 'tool_use') {
      break;
    }

    // Process tool calls
    const toolUseBlocks = content.filter(b => b.type === 'tool_use');
    if (toolUseBlocks.length === 0) break;

    // Add assistant message with tool_use blocks
    apiMessages.push({ role: 'assistant', content });

    // Execute each tool and collect results
    const toolResults: Array<{ type: string; tool_use_id: string; content: string }> = [];
    for (const toolBlock of toolUseBlocks) {
      const toolName = toolBlock.name!;
      const toolInput = toolBlock.input ?? {};

      // Log audit entry for each tool call
      logAuditEntry({
        caller: callerIdentity,
        intentType: toolName,
        action: `tool_call`,
        result: 'executed',
        details: JSON.stringify(toolInput).slice(0, 500),
      }).catch(err => console.error('[conversational-engine] Audit log failed:', err));

      try {
        const result = await executeTool(toolName, toolInput, callerIdentity);
        toolResults.push({ type: 'tool_result', tool_use_id: toolBlock.id!, content: result });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Tool execution failed';
        console.error(`[conversational-engine] Tool ${toolName} failed:`, error);
        toolResults.push({ type: 'tool_result', tool_use_id: toolBlock.id!, content: JSON.stringify({ error: errMsg }) });
      }
    }

    // Add tool results as user message
    apiMessages.push({ role: 'user', content: toolResults });
  }

  if (!finalText) {
    finalText = "I processed your request but couldn't generate a response. Please try again.";
  }

  // Build updated conversation history
  const timestamp = new Date().toISOString();
  const updatedHistory: ConversationMessage[] = [
    ...conversationHistory,
    { role: 'user', content: messageText, timestamp },
    { role: 'assistant', content: finalText, timestamp },
  ];

  return { response: finalText, updatedHistory };
}
