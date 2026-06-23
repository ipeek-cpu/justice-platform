/**
 * Conversational Engine — Replaces intent-parser + action-executor.
 *
 * Single Claude API call with tool_use. The model decides which tools to call
 * and the engine executes them in a loop (max 5 rounds).
 *
 * 39 tools. See TOOL_DEFINITIONS array.
 * Tools: query_case_metrics, query_case, create_task, list_tasks, complete_task,
 *        draft_email, confirm_send_email, schedule_meeting, schedule_batch, check_calendar,
 *        get_status_briefing, justice_status, unstick_task
 */

import { getCaseMetrics, getCaseBySessionId, createTask, getTasksByAssignee, completeTask, completeTaskByTitle, logAuditEntry } from '../db/queries';
import { searchNotion, readNotionPage, createNotionPage, appendToNotionPage, queryNotionDatabase } from '../integrations/notion-client';
import { getCalendarEvents, createCalendarEvent, sendGmail, sendGmailWithAttachment, hasGoogleAuth, getConnectedAccounts } from '../integrations/google-workspace';
import { configureNudge, getNudgeState } from '../nudge/task-nudger';
import { runMorningBrief, getMorningBriefState, setMorningBriefEnabled } from '../nudge/morning-brief';
import { appendToMemory } from '../memory/session-logger';
import { draftOutreachBatch } from './linkedin-outreach';
import { generateTailoredResume, generateBatch } from './resume-engine';
import { notionLogger } from '../integrations/notion-logger';
import { sendGuardedIMessage } from '../nudge/send-guard';
import { getProject, listProjects, reloadRegistry } from '../registry/ios-projects';
import { listActiveCheckouts, atomicClaim, cleanupTask, releaseTask } from '@justice/shared-types';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { runReviewAgent } from './review-agent';
import { runOvernightSession, runBuildCheck } from './overnight-runner';
import { buildPRDescription, createDraftPR, ensureRepo, createTaskBranch } from '../integrations/github';
import { resolveBatchOrder, getBeadsByLabel, saveBatchState, getBatchState, getActiveBatches, deleteBatchState, runBatchAsync, type BatchState } from './batch-runner';
import { createApproval, formatStamp, listPendingApprovals } from '../integrations/approval-gate';
import { executionLogger } from '../integrations/execution-logger';
import { shellExec } from '../integrations/shell-exec';
import { runPhase, waitForApproval, type TaskSession } from './code-executor';
import { isAutonomousBatchEnabled, BATCH_DISABLED_MESSAGE } from '../config/feature-flags';
import { runJobDiscovery } from './job-discovery';
import { runJobDigest } from '../nudge/job-digest';
import { runApplyAssist } from './apply-assist';
import { addDynamicTarget, enabledTargets } from '../config/target-companies';

const execAsync = promisify(exec);

const ISAIAH = process.env.APPROVED_NUMBER_ISAIAH!;

/** Map friendly names → actual email addresses for "send from X" syntax. */
const EMAIL_ALIASES: Record<string, string> = {
  work: process.env.ISAIAH_WORK_EMAIL ?? 'Isaiah@wolflaw.ai',
  wolflaw: 'Isaiah@wolflaw.ai',
  personal: process.env.ISAIAH_PERSONAL_EMAIL ?? '',
  ipeekwork: process.env.ISAIAH_PERSONAL_EMAIL ?? '',
};

function resolveEmailAlias(input: string): string {
  if (input.includes('@')) return input;
  return EMAIL_ALIASES[input.toLowerCase()] || input;
}

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
    name: 'complete_task_by_title',
    description:
      'Mark a pending task as completed by fuzzy-matching the title. Use this when the user says they finished/read/completed something by name (e.g. "done with X", "I read X") instead of an ID. Defaults to the caller as assignee. If multiple pending tasks match, returns the candidate list so you can ask the user which one.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title_fragment: {
          type: 'string',
          description:
            'A distinctive substring of the task title (e.g. "Psalms 23" or "demo deck"). Case-insensitive.',
        },
        assignee: {
          type: 'string',
          description: 'Optional assignee filter — defaults to the caller.',
        },
      },
      required: ['title_fragment'],
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
    description: 'Schedule a single meeting or call with attendees on Google Calendar. For multiple events, time blocks, or recurring schedules use schedule_batch instead.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Meeting title' },
        attendees: { type: 'array', items: { type: 'string' }, description: 'Attendee names or emails' },
        proposed_time: { type: 'string', description: 'Proposed time for the meeting' },
        duration: { type: 'string', description: 'Meeting duration (e.g., "30 min", "1 hour")' },
        notes: { type: 'string', description: 'Additional notes' },
        confirm: { type: 'boolean', description: 'Set true ONLY after the user explicitly confirms an unusually far-future date (>120 days out). Do not set by default.' },
      },
      required: ['title', 'attendees'],
    },
  },
  {
    name: 'schedule_batch',
    description: 'Create multiple calendar events at once. Use for recurring blocks, weekly schedules, multi-day planning.',
    input_schema: {
      type: 'object' as const,
      properties: {
        events: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
              start_time: { type: 'string', description: 'Start time in HH:MM 24h format' },
              end_time: { type: 'string', description: 'End time in HH:MM 24h format' },
              notes: { type: 'string' },
            },
            required: ['title', 'date', 'start_time', 'end_time'],
          },
          description: 'Array of events to create',
        },
        timezone: { type: 'string', description: 'IANA timezone (default: America/Chicago)' },
        confirm: { type: 'boolean', description: 'Set true ONLY after the user explicitly confirms unusually far-future dates (>120 days out). Do not set by default.' },
      },
      required: ['events'],
    },
  },
  {
    name: 'check_calendar',
    description: 'Check the calendar for a given date range.',
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
  {
    name: 'resume_generate',
    description: 'Generate a tailored resume YAML for a specific job. Reorders and filters master resume data to match the job description. Never invents content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        company_name: { type: 'string', description: 'Target company name' },
        role_title: { type: 'string', description: 'Target role/job title' },
        job_description: { type: 'string', description: 'Full job description text' },
      },
      required: ['company_name', 'role_title', 'job_description'],
    },
  },
  {
    name: 'resume_batch',
    description: 'Generate tailored resumes for multiple roles in batch. Each gets its own YAML variant.',
    input_schema: {
      type: 'object' as const,
      properties: {
        roles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              company_name: { type: 'string' },
              role_title: { type: 'string' },
              job_description: { type: 'string' },
            },
            required: ['company_name', 'role_title', 'job_description'],
          },
          description: 'List of target roles to generate resumes for',
        },
      },
      required: ['roles'],
    },
  },
  {
    name: 'email_resume',
    description: 'Generate a tailored resume and email the PDF to a specified address. Combines resume generation with email delivery.',
    input_schema: {
      type: 'object' as const,
      properties: {
        company_name: { type: 'string', description: 'Target company name' },
        role_title: { type: 'string', description: 'Target role/job title' },
        job_description: { type: 'string', description: 'Full job description text' },
        email_to: { type: 'string', description: 'Email address to send the resume to (defaults to Isaiah)' },
      },
      required: ['company_name', 'role_title', 'job_description'],
    },
  },
  {
    name: 'checkout_status',
    description: 'List all currently checked-out autonomous code execution tasks.',
    input_schema: { type: 'object' as const, properties: {}, required: [] as string[] },
  },
  {
    name: 'ios_build',
    description: 'Build an iOS project using xcodebuild. Reports success/failure.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'string', description: 'Registered project ID' }
      },
      required: ['project_id']
    }
  },
  {
    name: 'ios_clean',
    description: 'Clear DerivedData and clean the Xcode build for a project.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'string' }
      },
      required: ['project_id']
    }
  },
  {
    name: 'ios_status',
    description: 'Get current status of an iOS project: open beads + last 5 commits.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'string' }
      },
      required: ['project_id']
    }
  },
  {
    name: 'ios_pr',
    description: 'Push current branch and create a draft PR for an iOS project. Requires Isaiah approval.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'string' },
        title: { type: 'string', description: 'PR title' }
      },
      required: ['project_id', 'title']
    }
  },
  {
    name: 'ios_review',
    description: 'Spawn review agent on current branch diff for an iOS project.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'string' }
      },
      required: ['project_id']
    }
  },
  {
    name: 'ios_run_overnight',
    description: 'Start an autonomous overnight run for an iOS project. Works through all unblocked beads, commits, builds, reviews, creates PR draft.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'string' }
      },
      required: ['project_id']
    }
  },
  {
    name: 'ios_start_bead',
    description: 'Claim a specific bead and start autonomous execution on it.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'string' },
        bead_id: { type: 'string', description: 'Bead ID e.g. MIGR-AUTH-001' }
      },
      required: ['project_id', 'bead_id']
    }
  },
  {
    name: 'justice_status',
    description: 'Show what Justice is currently doing — active tasks, pending approvals, last events.',
    input_schema: { type: 'object' as const, properties: {}, required: [] as string[] }
  },
  {
    name: 'unstick_task',
    description: 'Kill a stuck task, release its checkout, and reopen the bead.',
    input_schema: {
      type: 'object' as const,
      properties: {
        bead_id: { type: 'string' }
      },
      required: ['bead_id']
    }
  },
  {
    name: 'justice_register',
    description: 'Register a new project with Justice. Reads config from Doppler env vars.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'string', description: 'Project ID (must have matching Doppler secrets)' }
      },
      required: ['project_id']
    }
  },
  {
    name: 'ios_start_batch',
    description: 'Run multiple beads sequentially on one branch, producing one review and one PR.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'string', description: 'Registered project ID' },
        bead_ids: { type: 'array', items: { type: 'string' }, description: 'Specific bead IDs' },
        label: { type: 'string', description: 'Run all open beads with this label (e.g. m1-auth)' },
        branch_name: { type: 'string', description: 'Optional custom branch name' },
        interactive: { type: 'boolean', description: 'Set true for per-bead approvals (default: false = overnight mode)' }
      },
      required: ['project_id']
    }
  },
  {
    name: 'ios_queue',
    description: 'Show current batch queue status for all active batches.',
    input_schema: { type: 'object' as const, properties: {}, required: [] as string[] }
  },
  {
    name: 'ios_resume_batch',
    description: 'Resume a paused or failed iOS batch from where it stopped. Can specify batch_id directly, or project_id to auto-find the most recent resumable batch.',
    input_schema: {
      type: 'object' as const,
      properties: {
        batch_id: { type: 'string', description: 'Batch ID to resume (optional if project_id given)' },
        project_id: { type: 'string', description: 'Project ID — finds the most recent paused/failed batch for this project' }
      },
      required: []
    }
  },
  {
    name: 'ios_push_branch',
    description: 'Push a batch branch and create a draft PR. Requires approval.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'string', description: 'Registered project ID' },
        batch_id: { type: 'string', description: 'Batch ID (optional if branch provided)' },
        branch: { type: 'string', description: 'Branch name (optional if batch_id provided)' },
        title: { type: 'string', description: 'PR title (optional)' }
      },
      required: ['project_id']
    }
  },
  {
    name: 'shell_exec',
    description: 'Execute a whitelisted shell command on the Mac Mini. Use for git operations (including git rm --cached), bd bead management, gh CLI, file operations. Security-checked against approved command list.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          description: 'Command to run. Must start with: git, bd, gh, xcodebuild, echo, cat, ls, mkdir, rm -f, mv, cp, grep, find, python3, node, curl, sed, chmod'
        },
        cwd: {
          type: 'string',
          description: 'Working directory (optional). Defaults to justice-repo root.'
        },
        timeout_ms: {
          type: 'number',
          description: 'Timeout in ms (optional). Default 30000, max 300000.'
        }
      },
      required: ['command']
    }
  },
  {
    name: 'run_job_discovery',
    description: 'Run the job-discovery pipeline now: source roles from enabled target companies, score them against the resume with Claude, and store new matches in the Notion jobs DB (scores in-memory if no jobs DB is configured).',
    input_schema: { type: 'object' as const, properties: {}, required: [] as string[] }
  },
  {
    name: 'job_digest',
    description: 'Send the job digest now — the top new matches from the Notion jobs DB, via iMessage. Bypasses the once-per-day guard.',
    input_schema: { type: 'object' as const, properties: {}, required: [] as string[] }
  },
  {
    name: 'apply_assist',
    description: 'Surface a shortlist of the best-fit roles and, only on explicit approval, draft LinkedIn outreach for Isaiah to review and send. NEVER submits applications or sends messages. Sources + scores fresh, then texts the shortlist and an approval request.',
    input_schema: {
      type: 'object' as const,
      properties: {
        context: { type: 'string', description: 'Short context for the outreach angle, e.g. "senior data engineering roles".' },
        top_n: { type: 'number', description: 'Max roles to shortlist (default 5).' },
        min_score: { type: 'number', description: 'Minimum fit score 0-100 to qualify (default 70).' }
      },
      required: [] as string[]
    }
  },
  {
    name: 'seed_job_target',
    description: 'Add a company/source to the job-discovery target list at runtime — no code change, picked up on the next run_job_discovery. Greenhouse/Lever need a board slug; serpapi/workday use a Google Jobs query (requires SERPAPI_KEY).',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Company/source display name (e.g. "Acme")' },
        ats: { type: 'string', enum: ['greenhouse', 'lever', 'serpapi', 'workday'], description: 'Sourcing path' },
        slug: { type: 'string', description: 'Board slug for greenhouse/lever (e.g. "stripe")' },
        query: { type: 'string', description: 'Google Jobs query for serpapi/workday (e.g. "Acme senior data engineer")' },
        lane: { type: 'string', enum: ['stable-FT', 'contract/startup'], description: 'Default lane (optional)' },
        industry: { type: 'string', description: 'Industry hint for scoring (optional)' }
      },
      required: ['name', 'ats'] as string[]
    }
  },
  {
    name: 'list_job_targets',
    description: 'List the job-discovery target companies/sources currently enabled (static registry + runtime-seeded).',
    input_schema: { type: 'object' as const, properties: {}, required: [] as string[] }
  },
];

/**
 * Sanity-check a proposed calendar event start time before it hits Google
 * Calendar. Blocks events in the past or absurdly far in the future (the
 * "April 2027" class of bug, where stale conversation context made the model
 * emit a wrong year). The far-future block is overridable with confirm=true so
 * a genuinely distant event can still be scheduled after explicit confirmation.
 */
function validateEventDate(
  startISO: string,
  confirm = false,
): { ok: true } | { ok: false; status: string; message: string } {
  const start = new Date(startISO);
  if (isNaN(start.getTime())) {
    return { ok: false, status: 'need_time', message: `Could not parse "${startISO}". Use ISO format: YYYY-MM-DDTHH:MM.` };
  }
  const now = Date.now();
  // 5-minute grace so "schedule for 2pm" at 1:59pm isn't rejected.
  if (start.getTime() < now - 5 * 60 * 1000) {
    const when = start.toLocaleString('en-US', { timeZone: 'America/Chicago' });
    return { ok: false, status: 'need_confirmation', message: `That time (${when}) is in the past. Did you mean a future date? Re-state the exact date and time.` };
  }
  const maxDaysOut = parseInt(process.env.JUSTICE_CALENDAR_MAX_DAYS_OUT ?? '', 10) || 120;
  const daysOut = (start.getTime() - now) / 86_400_000;
  if (daysOut > maxDaysOut && !confirm) {
    const label = start.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'long', day: 'numeric', year: 'numeric' });
    return { ok: false, status: 'need_confirmation', message: `That lands on ${label} — ${Math.round(daysOut)} days out, beyond the normal ${maxDaysOut}-day window. If you really mean ${label}, re-issue the request with confirm: true. Otherwise double-check the year (did you mean this year?).` };
  }
  return { ok: true };
}

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
- NEVER invent or guess names of people, companies, cases, or deals. Refer only to entities that appear in the conversation, tool results, or stored data. If you don't have a name, ask or say you don't have it — do not fabricate one (no "Sarah Chin", no made-up deals).
- When scheduling, never silently use a far-future or past date. Resolve relative dates against the current date shown above, and if a computed date is more than ~4 months out, confirm the year with the user before scheduling.
- Log all actions for audit trail.
- Be concise in responses — this is a text/iMessage conversation.
- Calendar checks show events from ALL connected Google accounts.
- Default to the primary (@wolflaw.ai) account for creating calendar events and sending email.
- If the user references a personal context or asks to send from a specific account, use the matching from_account.
- Do NOT ask which account to use unless the context is ambiguous — infer from the conversation.
- Email "from" aliases: "work" or "wolflaw" → Isaiah@wolflaw.ai, "personal" or "ipeekwork" → ipeekwork@gmail.com, or pass a full email address.
- When user says "email from work to ..." set from_account to "work". When they say "email from ipeekwork to ..." set from_account to "ipeekwork".

Nudges: I proactively remind you about upcoming and overdue tasks via iMessage. You can pause, snooze, or check nudge status.
- Morning brief: I send you a daily briefing at 8 AM with tasks, deadlines, and case updates. You can ask me to send one now, or disable/enable them.

Task-completion intents (CRITICAL — do not ignore):
- Treat short replies like "Done", "Done with X", "I read/finished/completed X", "X is done", "knocked out X", "took care of X" as a request to mark a task complete.
- For a named task ("I read Psalms 23 and Hebrews"), call complete_task_by_title with a distinctive fragment of the title (e.g. "Psalms 23"). Do NOT call list_tasks first.
- For a bare "Done" with no name, only act if a single task was discussed in recent turns; otherwise ask "Which task?".
- If complete_task_by_title returns status="ambiguous", ask the user which one (show titles + short IDs).
- If status="not_found", tell the user it's already completed (or doesn't exist) — don't pretend you did it.
- Always confirm completion back briefly: "Marked '<title>' done."

Available actions: query case metrics, look up cases, create/list/complete tasks, draft and send emails, schedule meetings, schedule batch events (use schedule_batch for "schedule my week with..." or "create daily blocks for..." — creates multiple calendar events at once), check calendar, provide status briefings, search/read/create/update Notion pages, configure task nudges, manage morning briefs, draft LinkedIn outreach (logged to Notion, never sent directly), log facts to long-term memory, check beads task status, queue autonomous code execution tasks, manage iOS project registry, generate tailored resumes (single, batch, or generate-and-email — rephrases and reorders resume content to match job descriptions, never fabricates), email resume PDFs as attachments, check task checkout status (see which autonomous tasks are currently claimed), and manage iOS projects (build, clean, status, PR, review, overnight runs, start specific beads).

iOS project commands — registered projects: ${listProjects().map(p => p.id).join(', ') || '(none)'}
- "[project] build" or "build [project]" — build with xcodebuild
- "[project] clean" — clear DerivedData and clean build
- "[project] status" — batch progress (if active), otherwise open beads + recent commits
- "[project] pr [title]" — create PR draft (requires approval to push)
- "[project] review" — spawn review agent on current branch diff
- "[project] run tonight" or "run [project] overnight" — autonomous overnight run
- "[project] start [bead-id]" — claim and start a specific bead
- "[project] batch [label]" or "[project] batch [bead1] [bead2]..." → ios_start_batch
- "[project] queue" or "batch status" → ios_queue
- "resume batch [id]" → ios_resume_batch
- "push batch [id]" or "push [project] [branch]" → ios_push_branch
- "justice status" or "what are you doing" → justice_status
- "unstick [bead-id]" → unstick_task (kill stuck task, release lock)
- "justice register [project-id]" → justice_register (register a new project from Doppler env vars)

Job search commands:
- "find jobs" or "run job discovery" → run_job_discovery (source + score roles into the Notion jobs DB)
- "job digest" or "any new jobs" → job_digest (text the top new matches now)
- "apply assist" or "draft outreach for jobs" → apply_assist (shortlist + approval-gated outreach drafts; never auto-submits or sends)
- "track [company]" / "add greenhouse|lever [slug]" / "seed job target" → seed_job_target (add a source at runtime; greenhouse/lever need a slug, serpapi needs a query)
- "list job targets" → list_job_targets

Direct shell operations (git rm, bd create, gh, etc.) → shell_exec
Examples:
- "bd create 'fix: RLS policy' -t task -p 1 --label fix,hlstc"
- "bd reopen hlstc-app-4en --reason 'No commits made'"
- "gh pr view 166 --repo theaionlab/hlstc-app"`;
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

    case 'complete_task_by_title': {
      const fragment = (input.title_fragment as string) ?? '';
      const assignee = (input.assignee as string) ?? callerIdentity;
      const result = await completeTaskByTitle(fragment, assignee);
      if (!result) {
        return JSON.stringify({
          status: 'not_found',
          message: `No pending task for ${assignee} matches "${fragment}". It may already be completed.`,
        });
      }
      if ('matches' in result) {
        return JSON.stringify({
          status: 'ambiguous',
          message: 'Multiple pending tasks match — ask the user which one.',
          matches: result.matches.map(m => ({
            id: m.id.slice(0, 8),
            title: m.title,
            deadline: m.deadline?.toISOString() ?? null,
          })),
        });
      }
      return JSON.stringify({
        status: 'completed',
        task_id: result.row.id.slice(0, 8),
        title: result.row.title,
      });
    }

    case 'draft_email': {
      const rawFrom = input.from_account as string | undefined;
      const draft = {
        to: input.to as string[],
        subject: input.subject as string,
        body: input.body as string,
        fromAccount: rawFrom ? resolveEmailAlias(rawFrom) : undefined,
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
      const rawOverride = input.from_account as string | undefined;
      const fromAccount = rawOverride ? resolveEmailAlias(rawOverride) : draft.fromAccount;
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
      const parsed = new Date(proposedTime);
      if (isNaN(parsed.getTime())) {
        return JSON.stringify({ status: 'need_time', message: `Could not parse "${proposedTime}". Please use ISO format: YYYY-MM-DDTHH:MM` });
      }
      const startTime = parsed.toISOString();
      const endTime = new Date(parsed.getTime() + durationMinutes * 60 * 1000).toISOString();

      const dateCheck = validateEventDate(startTime, input.confirm === true);
      if (!dateCheck.ok) {
        return JSON.stringify({ status: dateCheck.status, title: input.title, proposed_time: startTime, message: dateCheck.message });
      }

      const result = await createCalendarEvent(callerIdentity, {
        title: input.title as string,
        attendees: (input.attendees as string[]) ?? [],
        startTime,
        endTime,
        notes: input.notes as string | undefined,
      });

      if ('error' in result) return JSON.stringify({ status: 'error', error: result.error });
      return JSON.stringify({
        status: 'scheduled',
        event_id: result.id,
        link: result.link,
        ...(result.meetLink && { meet_link: result.meetLink }),
      });
    }

    case 'schedule_batch': {
      const hasAuth = await hasGoogleAuth(callerIdentity);
      if (!hasAuth) {
        return JSON.stringify({ error: `Calendar not connected — visit /api/oauth/google/authorize?user=${callerIdentity}` });
      }

      const events = input.events as Array<{ title: string; date: string; start_time: string; end_time: string; notes?: string }>;
      const _tz = (input.timezone as string) || 'America/Chicago'; // reserved for future use; createCalendarEvent hardcodes America/Chicago
      const results: Array<{ title: string; date: string; status: string; link?: string; meet_link?: string; error?: string }> = [];

      const confirmFarFuture = input.confirm === true;
      for (const evt of events) {
        const startTime = `${evt.date}T${evt.start_time}:00`;
        const endTime = `${evt.date}T${evt.end_time}:00`;

        const dateCheck = validateEventDate(startTime, confirmFarFuture);
        if (!dateCheck.ok) {
          results.push({ title: evt.title, date: evt.date, status: 'skipped', error: dateCheck.message });
          continue;
        }

        const calResult = await createCalendarEvent(callerIdentity, {
          title: evt.title,
          attendees: [],
          startTime,
          endTime,
          notes: evt.notes,
        });
        if ('error' in calResult) {
          results.push({ title: evt.title, date: evt.date, status: 'failed', error: calResult.error });
        } else {
          results.push({ title: evt.title, date: evt.date, status: 'created', link: calResult.link, ...(calResult.meetLink && { meet_link: calResult.meetLink }) });
        }
      }

      const created = results.filter(r => r.status === 'created').length;
      const failed = results.filter(r => r.status === 'failed').length;
      const skipped = results.filter(r => r.status === 'skipped').length;
      return JSON.stringify({ created, failed, skipped, total: events.length, details: results });
    }

    case 'check_calendar': {
      const hasAuth = await hasGoogleAuth(callerIdentity);
      if (!hasAuth) {
        return JSON.stringify({ error: `Calendar not connected for ${callerIdentity} — visit /api/oauth/google/authorize?user=${callerIdentity}` });
      }

      const range = (input.range as string) ?? 'today';
      // Compute "today" in Chicago time to avoid UTC date drift
      const tz = process.env.JUSTICE_TIMEZONE ?? 'America/Chicago';
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
      const todayBase = new Date(todayStr + 'T00:00:00');
      const DAY = 24 * 60 * 60 * 1000;
      let timeMin: Date;
      let timeMax: Date;

      switch (range) {
        case 'tomorrow':
          timeMin = new Date(todayBase.getTime() + DAY);
          timeMax = new Date(todayBase.getTime() + 2 * DAY);
          break;
        case 'this_week': {
          const dayOfWeek = todayBase.getDay();
          timeMin = new Date(todayBase.getTime() - dayOfWeek * DAY);
          timeMax = new Date(todayBase.getTime() + (7 - dayOfWeek) * DAY);
          break;
        }
        case 'next_week': {
          const dayOfWeek = todayBase.getDay();
          timeMin = new Date(todayBase.getTime() + (7 - dayOfWeek) * DAY);
          timeMax = new Date(todayBase.getTime() + (14 - dayOfWeek) * DAY);
          break;
        }
        default: // 'today' or specific date
          if (input.date) {
            timeMin = new Date(input.date as string);
            timeMax = new Date(timeMin.getTime() + DAY);
          } else {
            timeMin = todayBase;
            timeMax = new Date(todayBase.getTime() + DAY);
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

    case 'resume_generate': {
      const result = await generateTailoredResume({
        companyName: input.company_name as string,
        roleTitle: input.role_title as string,
        jobDescription: input.job_description as string,
      });
      return JSON.stringify({
        success: true,
        yaml_path: result.variantYamlPath,
        diff_summary: result.diffSummary,
      });
    }

    case 'email_resume': {
      const result = await generateTailoredResume({
        companyName: input.company_name as string,
        roleTitle: input.role_title as string,
        jobDescription: input.job_description as string,
      });
      const emailTo = (input.email_to as string) || 'isaiahmpeek@gmail.com';
      const fs = require('fs');
      if (fs.existsSync(result.pdfPath)) {
        const emailResult = await sendGmailWithAttachment(
          callerIdentity,
          [emailTo],
          `Tailored Resume - ${input.role_title} at ${input.company_name}`,
          `Here's your tailored resume for ${input.role_title} at ${input.company_name}.\n\nWhat changed:\n${result.diffSummary}`,
          { filename: `resume_${(input.company_name as string).toLowerCase().replace(/\s+/g, '_')}.pdf`, path: result.pdfPath, mimeType: 'application/pdf' },
        );
        if ('error' in emailResult) {
          return JSON.stringify({ success: false, error: emailResult.error, yaml_path: result.variantYamlPath });
        }
        return JSON.stringify({ success: true, emailed_to: emailTo, pdf_path: result.pdfPath, diff_summary: result.diffSummary });
      }
      // PDF not generated — send YAML path instead
      return JSON.stringify({ success: true, pdf_generated: false, yaml_path: result.variantYamlPath, diff_summary: result.diffSummary, message: 'PDF not available — resume generator may not be running. YAML variant saved.' });
    }

    case 'resume_batch': {
      const roles = input.roles as Array<{ company_name: string; role_title: string; job_description: string }>;
      const batchPageId = await notionLogger.createTaskPage(
        `Resume Batch — ${new Date().toISOString().split('T')[0]}`,
        `${roles.length} resumes`
      );
      const targets = roles.map(r => ({
        companyName: r.company_name,
        roleTitle: r.role_title,
        jobDescription: r.job_description,
      }));
      const results = await generateBatch(targets, batchPageId);
      const link = notionLogger.pageUrl(batchPageId);
      await sendGuardedIMessage(ISAIAH, `${results.length} resume(s) ready — Check Notion: ${link}`);
      return JSON.stringify({
        success: true,
        count: results.length,
        notion_page: link,
      });
    }

    case 'checkout_status': {
      const checkouts = await listActiveCheckouts();
      if (checkouts.length === 0) {
        return JSON.stringify({ message: 'No active task checkouts.' });
      }
      const lines = checkouts.map(c => `${c.beadId} -> ${c.agentId}`).join('\n');
      return JSON.stringify({ active_checkouts: lines });
    }

    case 'ios_build': {
      const project = getProject(input.project_id as string);
      if (!project) return JSON.stringify({ error: `Unknown project: ${input.project_id}` });
      const { success, output } = await runBuildCheck(project);
      const buildPageId = await notionLogger.createTaskPage(`${project.name} Build Check`, '');
      await notionLogger.logPhaseComplete(
        buildPageId,
        { number: 1, id: 'build', name: 'Build', prompt: '' },
        output, success ? 0 : 1
      );
      return JSON.stringify({
        success,
        message: success ? `${project.name} build succeeded` : `${project.name} build failed - details in Notion`,
        notion: notionLogger.pageUrl(buildPageId)
      });
    }

    case 'ios_clean': {
      const project = getProject(input.project_id as string);
      if (!project) return JSON.stringify({ error: `Unknown project: ${input.project_id}` });
      await execAsync(`rm -rf ~/Library/Developer/Xcode/DerivedData/${project.xcodeSchemeName}*`).catch(() => {});
      await execAsync(`xcodebuild clean -scheme ${project.xcodeSchemeName}`, { cwd: project.localPath }).catch(() => {});
      return JSON.stringify({ message: `${project.name} derived data cleared and project cleaned` });
    }

    case 'ios_status': {
      const project = getProject(input.project_id as string);
      if (!project) return JSON.stringify({ error: `Unknown project: ${input.project_id}` });

      // Check active batches first — usually what "status" means during a run
      const allBatches = await getActiveBatches();
      const projectBatches = allBatches.filter(b => b.projectId === project.id);

      if (projectBatches.length > 0) {
        const batchSummaries = projectBatches.map(b => {
          const completed = b.results.filter(r => r.status === 'completed').length;
          const failed = b.results.filter(r => r.status === 'failed').length;
          const pct = b.beadOrder.length > 0
            ? Math.round((completed / b.beadOrder.length) * 100) : 0;
          return (
            `batch ${b.batchId.split('-').slice(-1)[0]} — ${b.status}\n` +
            `  ${completed}/${b.beadOrder.length} beads (${pct}%), ${failed} failed\n` +
            `  Branch: ${b.branch}\n` +
            `  Current: ${b.beadOrder[b.currentIndex] ?? 'post-loop'}\n` +
            `  Notion: ${notionLogger.pageUrl(b.notionPageId)}`
          );
        }).join('\n\n');

        const { stdout: openJson } = await execAsync(
          `${process.env.HOME}/.local/bin/bd list --status open --json 2>/dev/null || echo "[]"`,
          { cwd: project.localPath }
        ).catch(() => ({ stdout: '[]' }));
        let openCount = 0;
        try { openCount = JSON.parse(openJson).length; } catch {}

        return JSON.stringify({
          message: `${project.name} — ${projectBatches.length} active batch(es):\n\n` +
            batchSummaries +
            (openCount > 0 ? `\n\n${openCount} open bead(s) queued.` : '')
        });
      }

      // No active batches — standard status
      const { stdout: beads } = await execAsync(`bd list --status open 2>/dev/null || echo "No open beads"`, { cwd: project.localPath }).catch(() => ({ stdout: 'Beads unavailable' }));
      const { stdout: inProgressBeads } = await execAsync(`bd list --status in_progress 2>/dev/null || echo "None"`, { cwd: project.localPath }).catch(() => ({ stdout: 'None' }));
      const { stdout: commits } = await execAsync(`git -C ${project.localPath} log --oneline -5`).catch(() => ({ stdout: 'No commits' }));

      const checkouts = await listActiveCheckouts();
      const projectCheckouts = checkouts.filter(c => c.beadId && inProgressBeads.includes(c.beadId));
      const inProgressDetails: string[] = [];
      for (const co of projectCheckouts) {
        const lastEvent = executionLogger.getLastEventForBead(co.beadId);
        const claimEvent = executionLogger.getActiveTasks().find(t => t.beadId === co.beadId);
        const runtimeMin = claimEvent ? Math.round((Date.now() - new Date(claimEvent.ts).getTime()) / 60000) : 0;
        const lastEventDesc = lastEvent ? `${lastEvent.event} (${Math.round((Date.now() - new Date(lastEvent.ts).getTime()) / 60000)}m ago)` : 'none';
        inProgressDetails.push(`${co.beadId} (running ${runtimeMin}m) — last: ${lastEventDesc}`);
      }

      const projectLastEvent = executionLogger.getLastEventForProject(project.id);
      const lastEventSummary = projectLastEvent
        ? `${projectLastEvent.event} ${projectLastEvent.beadId ?? ''} (${Math.round((Date.now() - new Date(projectLastEvent.ts).getTime()) / 60000)}m ago)`
        : 'none';

      return JSON.stringify({
        project: project.name,
        in_progress: inProgressDetails.length > 0 ? inProgressDetails : 'None',
        open_beads: beads.trim(),
        recent_commits: commits.trim(),
        last_project_event: lastEventSummary,
      });
    }

    case 'ios_pr': {
      const project = getProject(input.project_id as string);
      if (!project) return JSON.stringify({ error: `Unknown project: ${input.project_id}` });
      const { stdout: branch } = await execAsync(`git -C ${project.localPath} branch --show-current`);
      const prPageId = await notionLogger.createTaskPage(`${project.name} PR — ${input.title}`, '');
      await notionLogger.logPRDraft(prPageId, {
        branch: branch.trim(),
        beadIds: [],
        phases: 1,
        testCoverage: 'See Notion'
      });
      const link = notionLogger.pageUrl(prPageId);
      const stamp = await createApproval(`pr-${project.id}`, `Push ${branch.trim()} and open PR`);
      return JSON.stringify({
        message: `PR draft ready. Check Notion: ${link}\n\nReply "yes ${stamp}" to push branch and open PR. ${formatStamp(stamp)}`,
        requires_approval: true,
        approval_id: stamp,
        branch: branch.trim()
      });
    }

    case 'ios_review': {
      const project = getProject(input.project_id as string);
      if (!project) return JSON.stringify({ error: `Unknown project: ${input.project_id}` });
      const reviewPageId = await notionLogger.createTaskPage(`${project.name} Code Review`, '');
      const session = { sessionId: `review-${Date.now()}`, beadId: 'review', taskName: 'Review', notionPageId: reviewPageId, startedAt: new Date(), phases: [] };
      const result = await runReviewAgent(session, project.localPath, project.defaultBranch, 'Ad-hoc review', reviewPageId);
      const link = notionLogger.pageUrl(reviewPageId);
      return JSON.stringify({
        status: result.status,
        concerns: result.concerns,
        suggestions: result.suggestions,
        notion: link
      });
    }

    case 'seed_job_target': {
      const ats = input.ats as 'greenhouse' | 'lever' | 'serpapi' | 'workday';
      if ((ats === 'greenhouse' || ats === 'lever') && !input.slug) {
        return JSON.stringify({ error: `${ats} targets need a board slug (e.g. "stripe").` });
      }
      const res = addDynamicTarget({
        name: input.name as string,
        ats,
        slug: input.slug as string | undefined,
        query: input.query as string | undefined,
        lane: (input.lane as 'stable-FT' | 'contract/startup') ?? 'stable-FT',
        industry: input.industry as string | undefined,
        enabled: true,
      });
      return JSON.stringify(res.added
        ? { message: `Added ${input.name} (${ats}${input.slug ? ' / ' + input.slug : input.query ? ' / "' + input.query + '"' : ''}). It'll be sourced on the next job discovery run.` }
        : { error: `Not added: ${res.reason}.` });
    }

    case 'list_job_targets': {
      const targets = enabledTargets().map(t => ({ name: t.name, ats: t.ats, slug: t.slug, query: t.query, lane: t.lane }));
      return JSON.stringify({ count: targets.length, targets });
    }

    case 'run_job_discovery': {
      const r = await runJobDiscovery();
      return JSON.stringify({
        sourced: r.sourced,
        new_after_dedup: r.newAfterDedup,
        scored: r.scored.length,
        stored: r.stored,
        ...(r.sourced === 0 && { note: 'No target companies are enabled yet (config/target-companies.ts) — nothing to source.' }),
      });
    }

    case 'job_digest': {
      await runJobDigest(true);
      return JSON.stringify({ message: 'Job digest sent (nothing sent if there were no new matches or the jobs DB is not configured).' });
    }

    case 'apply_assist': {
      const ctx = (input.context as string) ?? 'data engineering roles';
      const opts = {
        topN: typeof input.top_n === 'number' ? (input.top_n as number) : undefined,
        minScore: typeof input.min_score === 'number' ? (input.min_score as number) : undefined,
      };
      // Fire-and-forget: source + score, then runApplyAssist surfaces the shortlist,
      // pings Isaiah for approval, and drafts outreach (for manual review/send) ONLY on YES.
      (async () => {
        const { scored } = await runJobDiscovery();
        await runApplyAssist(scored, ctx, opts);
      })().catch(err => {
        if (ISAIAH) sendGuardedIMessage(ISAIAH, `Apply-assist failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      });
      return JSON.stringify({ message: 'Apply-assist started — sourcing + scoring now. I\'ll text you the shortlist and an approval request before drafting any outreach. Nothing is ever submitted or sent automatically.' });
    }

    case 'ios_run_overnight': {
      if (!isAutonomousBatchEnabled()) return JSON.stringify({ error: BATCH_DISABLED_MESSAGE });
      const project = getProject(input.project_id as string);
      if (!project) return JSON.stringify({ error: `Unknown project: ${input.project_id}` });
      // Fire and forget — runs async, reports via iMessage at completion
      runOvernightSession(input.project_id as string).catch(err =>
        sendGuardedIMessage(ISAIAH, `Overnight run failed for ${project.name}: ${err.message}`)
      );
      return JSON.stringify({ message: `${project.name} overnight run started. You'll get an iMessage when complete.` });
    }

    case 'ios_start_bead': {
      if (!isAutonomousBatchEnabled()) return JSON.stringify({ error: BATCH_DISABLED_MESSAGE });
      const project = getProject(input.project_id as string);
      if (!project) return JSON.stringify({ error: `Unknown project: ${input.project_id}` });

      const beadId = input.bead_id as string;
      const sessionId = `ios-${input.project_id}-${Date.now()}`;

      const claimed = await atomicClaim(beadId, sessionId);
      if (!claimed) return JSON.stringify({ error: `${beadId} is already being worked on.` });

      executionLogger.log({ event: 'bead_claimed', beadId, project: project.id, sessionId });

      // Ensure repo is cloned / up-to-date
      await ensureRepo(project);

      // Get bead details
      let beadTitle = beadId;
      let beadDescription = '';
      try {
        const { stdout: beadJson } = await execAsync(
          `${process.env.HOME}/.local/bin/bd show ${beadId} --json`,
          { cwd: project.localPath }
        );
        const bead = JSON.parse(beadJson);
        beadTitle = bead.title ?? beadId;
        beadDescription = bead.description ?? '';
      } catch { /* use defaults */ }

      // Create Notion task page
      const pageId = await notionLogger.createTaskPage(
        `${project.name} — ${beadTitle}`,
        `Bead: ${beadId}\n${beadDescription}`
      );
      await notionLogger.logTimelineEvent(pageId, 'running', `Task started: ${beadTitle}`);

      // Create feature branch
      const branch = await createTaskBranch(project.localPath, beadId, beadTitle);

      // Record before-commit hash
      const { stdout: beforeCommit } = await execAsync(
        `git -C ${project.localPath} rev-parse HEAD`
      );

      // Build execution prompt
      const executionPrompt = [
        `Complete this task: ${beadTitle}`,
        '',
        beadDescription ? `Acceptance criteria:\n${beadDescription}` : '',
        '',
        `Project: ${project.name} at ${project.localPath}`,
        `Branch: ${branch}`,
        `Bead ID: ${beadId}`,
        '',
        'Write and modify files as needed. Do not run git commands — Justice handles all staging and commits.',
      ].filter(Boolean).join('\n');

      const session: TaskSession = {
        sessionId,
        beadId,
        taskName: beadTitle,
        notionPageId: pageId,
        startedAt: new Date(),
        phases: [{ number: 1, id: beadId, name: beadTitle, prompt: executionPrompt, workingDir: project.localPath }],
      };

      // Fire-and-forget: actually run the phase
      (async () => {
        try {
          const result = await runPhase(session, session.phases[0], { skipClaim: true, skipCleanup: true });

          // Justice commits any changes Claude Code produced
          if (result.success) {
            const { stdout: statusOutput } = await execAsync(
              `git -C ${project.localPath} status --porcelain`
            ).catch(() => ({ stdout: '' }));

            if (statusOutput.trim()) {
              await execAsync(`git -C ${project.localPath} add -A`);
              await execAsync(
                `git -C ${project.localPath} commit -m "feat(${beadId}): ${beadTitle}"`
              );
              executionLogger.log({
                event: 'commit_made', beadId, project: project.id, sessionId,
              });
              await notionLogger.logTimelineEvent(pageId, 'success', `Justice committed changes for ${beadId}`);
            }
          }

          // Check if commits were made
          const { stdout: afterCommit } = await execAsync(
            `git -C ${project.localPath} rev-parse HEAD`
          );
          const hasCommits = afterCommit.trim() !== beforeCommit.trim();

          if (result.success && hasCommits) {
            // --- in_review: commits verified ---
            await execAsync(`${process.env.HOME}/.local/bin/bd update ${beadId} --status in_review`).catch(() => {});
            executionLogger.log({ event: 'bead_in_review', beadId, project: project.id, sessionId, commitHash: afterCommit.trim() });
            await notionLogger.logTimelineEvent(pageId, 'waiting', 'In review — awaiting push approval');

            // Run review agent — findings logged to Notion automatically
            const review = await runReviewAgent(session, project.localPath, project.defaultBranch, beadTitle, pageId);
            const concernCount = review.concerns.length;

            // Ask Isaiah for push approval (sends iMessage + polls)
            const approved = await waitForApproval(
              session,
              `${beadId} in review. ${review.status}. ${concernCount} concern(s). Branch: ${branch}. Notion: ${notionLogger.pageUrl(pageId)}. Approve push?`
            );

            if (approved) {
              // Push + create draft PR
              await execAsync(`git -C ${project.localPath} push origin ${branch}`);

              const { stdout: commitLog } = await execAsync(
                `git -C ${project.localPath} log ${project.defaultBranch}..HEAD --oneline`
              ).catch(() => ({ stdout: '' }));

              const prBody = buildPRDescription({
                title: beadTitle,
                branch,
                beadIds: [beadId],
                phases: commitLog.trim().split('\n').filter(Boolean),
                testCoverage: 'Build: verified by review agent',
                reviewStatus: review.status,
                concerns: review.concerns,
              });

              const prUrl = await createDraftPR(project.localPath, beadTitle, prBody);

              await execAsync(`${process.env.HOME}/.local/bin/bd close ${beadId} --reason "PR created: ${prUrl}"`).catch(() => {});
              executionLogger.log({ event: 'bead_complete', beadId, project: project.id, sessionId, prUrl });
              await notionLogger.logTimelineEvent(pageId, 'success', `PR created: ${prUrl}`);
              await sendGuardedIMessage(ISAIAH, `PR open: ${prUrl}`);
            } else {
              // Push declined — reopen bead
              await execAsync(`${process.env.HOME}/.local/bin/bd update ${beadId} --status open`).catch(() => {});
              await notionLogger.logTimelineEvent(pageId, 'failed', 'Push declined by Isaiah');
              await sendGuardedIMessage(ISAIAH, `Push declined. Bead ${beadId} reopened. What should I change?`);
            }
          } else {
            // No commits or phase failed — reopen bead
            await execAsync(`${process.env.HOME}/.local/bin/bd reopen ${beadId} --reason "No commits produced in session ${sessionId}"`).catch(() => {});
            executionLogger.log({ event: 'bead_failed', beadId, project: project.id, sessionId, reason: hasCommits ? 'phase failed' : 'no commits' });
            await notionLogger.logTimelineEvent(pageId, 'failed', `Task failed — ${hasCommits ? 'phase error' : 'no commits produced'}`);
            await sendGuardedIMessage(ISAIAH,
              `${project.name} — ${beadTitle} failed (${hasCommits ? 'phase error' : 'zero commits'}).\n` +
              `Bead ${beadId} reopened. Check Notion: ${notionLogger.pageUrl(pageId)}`
            );
          }
        } catch (err) {
          executionLogger.log({ event: 'bead_failed', beadId, project: project.id, sessionId, error: String(err) });
          await notionLogger.logTimelineEvent(pageId, 'failed', `Task error: ${String(err).slice(0, 100)}`);
          await sendGuardedIMessage(ISAIAH,
            `${project.name} — ${beadTitle} stuck.\nError: ${String(err).slice(0, 200)}\nCheck Notion: ${notionLogger.pageUrl(pageId)}`
          );
        } finally {
          await cleanupTask(beadId, sessionId);
        }
      })();

      // Return immediately with Notion link
      const notionUrl = notionLogger.pageUrl(pageId);
      return JSON.stringify({
        message: `Started ${beadTitle} for ${project.name}. Claude Code is running autonomously.`,
        notion: notionUrl,
        branch,
        bead_id: beadId,
        session_id: sessionId,
      });
    }

    case 'justice_status': {
      const activeTasks = executionLogger.getActiveTasks();
      const recentEvents = executionLogger.readRecent(5);

      if (activeTasks.length === 0) {
        return JSON.stringify({
          status: 'idle',
          message: 'No active tasks. Ready for new tasks.',
          recent: recentEvents.map(e => `${e.event} ${e.beadId ?? ''} ${e.ts}`),
        });
      }

      const taskSummaries = await Promise.all(activeTasks.map(async (t) => {
        const runtimeMs = Date.now() - new Date(t.ts).getTime();
        const runtimeMin = Math.round(runtimeMs / 60000);
        const lastEvent = t.beadId ? executionLogger.getLastEventForBead(t.beadId) : null;
        const lastEventAge = lastEvent ? Math.round((Date.now() - new Date(lastEvent.ts).getTime()) / 60000) : null;
        const lastEventDesc = lastEvent ? `${lastEvent.event} (${lastEventAge}m ago)` : 'none';
        const stuckFlag = lastEventAge !== null && lastEventAge > 30 ? ' ⚠️ POSSIBLY STUCK' : '';

        // Check if subprocess PID is still alive
        let pidStatus = '';
        if (t.beadId) {
          const pid = executionLogger.getSubprocessPid(t.beadId);
          if (pid) {
            try {
              process.kill(pid, 0); // signal 0 = just check if alive
              pidStatus = ` | PID ${pid} alive`;
            } catch {
              pidStatus = ` | PID ${pid} dead`;
            }
          }
        }

        return `${t.beadId} (${t.project ?? 'unknown'}) — running ${runtimeMin}m | last: ${lastEventDesc}${pidStatus}${stuckFlag}`;
      }));

      return JSON.stringify({
        status: 'active',
        active_tasks: taskSummaries,
        recent: recentEvents.map(e => `${e.event} ${e.beadId ?? ''} ${e.ts}`),
      });
    }

    case 'unstick_task': {
      if (!isAutonomousBatchEnabled()) return JSON.stringify({ error: BATCH_DISABLED_MESSAGE });
      const beadId = input.bead_id as string;
      const checkouts = await listActiveCheckouts();
      const checkout = checkouts.find(c => c.beadId === beadId);

      if (checkout) {
        await releaseTask(beadId, checkout.agentId);
      }

      await execAsync(`bd reopen ${beadId} --reason "Unstuck by Isaiah via unstick_task"`).catch(() => {});
      executionLogger.log({ event: 'bead_unstuck', beadId, reason: 'Manual unstick via unstick_task' });

      return JSON.stringify({
        message: `Released ${beadId}. Lock cleared, bead reopened.`,
        was_checked_out: !!checkout,
      });
    }

    case 'justice_register': {
      const projectId = (input.project_id as string).toLowerCase();
      const prefix = projectId.toUpperCase().replace(/-/g, '_');

      // Verify required env vars exist
      const repoName = process.env[`${prefix}_REPO_NAME`];
      const localPath = process.env[`${prefix}_LOCAL_PATH`];
      if (!repoName || !localPath) {
        return JSON.stringify({
          error: `Missing Doppler secrets: ${prefix}_REPO_NAME and/or ${prefix}_LOCAL_PATH. Set them in Doppler first.`,
        });
      }

      const repoOrg = process.env[`${prefix}_REPO_ORG`] ?? 'theaionlab';

      // Clone repo if localPath doesn't exist
      const fs = require('fs');
      if (!fs.existsSync(localPath)) {
        try {
          await execAsync(`gh repo clone ${repoOrg}/${repoName} ${localPath}`);
        } catch (err) {
          return JSON.stringify({ error: `Clone failed: ${String(err).slice(0, 200)}` });
        }
      }

      // Reload registry to pick up new project
      reloadRegistry();
      const project = getProject(projectId);
      if (!project) {
        return JSON.stringify({ error: `Registry reload failed — ensure JUSTICE_REGISTERED_PROJECTS includes "${projectId}"` });
      }

      return JSON.stringify({
        message: `Registered ${project.name} (${project.id})`,
        project: { id: project.id, name: project.name, localPath: project.localPath, stack: project.stack },
      });
    }

    case 'ios_start_batch': {
      if (!isAutonomousBatchEnabled()) return JSON.stringify({ error: BATCH_DISABLED_MESSAGE });
      const project = getProject(input.project_id as string);
      if (!project) return JSON.stringify({ error: `Unknown project: ${input.project_id}` });

      // Resolve beads: from explicit IDs or by label
      let beads: Array<{ id: string; title: string; description: string; deps?: string[] }> = [];
      if (input.bead_ids && (input.bead_ids as string[]).length > 0) {
        for (const id of input.bead_ids as string[]) {
          try {
            const { stdout } = await execAsync(
              `${process.env.HOME}/.local/bin/bd show ${id} --json`,
              { cwd: project.localPath }
            );
            const parsed = JSON.parse(stdout);
            const bead = Array.isArray(parsed) ? parsed[0] : parsed;
            beads.push({ id, title: bead.title ?? id, description: bead.description ?? '', deps: (bead.dependencies ?? []).map((d: any) => d.depends_on_id) });
          } catch {
            beads.push({ id, title: id, description: '', deps: [] });
          }
        }
      } else if (input.label) {
        beads = await getBeadsByLabel(input.label as string, project.localPath);
      }

      if (beads.length === 0) {
        return JSON.stringify({ error: 'No beads found. Provide bead_ids or a label with open beads.' });
      }

      // Topological sort
      let orderedIds = resolveBatchOrder(beads);

      // Guard 0: Clean up stale same-project batches before checking for conflicts
      const activeBatches = await getActiveBatches();
      const staleProjectBatches = activeBatches.filter(
        b => b.projectId === project.id && b.status === 'running'
      );
      for (const stale of staleProjectBatches) {
        const completedCount = stale.results.filter(r => r.status === 'completed').length;
        if (completedCount === stale.beadOrder.length && completedCount > 0) {
          stale.status = 'approved' as any;
        } else {
          stale.status = 'failed';
        }
        stale.updatedAt = new Date().toISOString();
        await saveBatchState(stale);
        await deleteBatchState(stale.batchId);
        executionLogger.log({ event: 'stale_batch_cleaned', batchId: stale.batchId, project: project.id, newStatus: stale.status });
      }

      // Guard 1: Check for active batches with overlapping beads (re-fetch after cleanup)
      const freshBatches = staleProjectBatches.length > 0 ? await getActiveBatches() : activeBatches;
      const conflicting = freshBatches.find(b =>
        b.projectId === project.id &&
        b.beadOrder.some(id => orderedIds.includes(id))
      );
      if (conflicting) {
        // Auto-resume if all beads completed but batch paused (post-loop stall)
        const allDone = conflicting.results.length > 0 &&
          conflicting.results.every(r => r.status === 'completed');

        if (allDone && conflicting.status === 'paused') {
          // Auto-resume — don't make Isaiah type the batch ID
          const resumeProject = getProject(conflicting.projectId);
          if (resumeProject) {
            conflicting.status = 'queued';
            await saveBatchState(conflicting);
            runBatchAsync(conflicting, resumeProject, conflicting.sessionId).catch(err => {
              sendGuardedIMessage(ISAIAH, `Auto-resume failed for ${conflicting.batchId}: ${String(err).slice(0, 200)}`);
            });
            return JSON.stringify({
              message: `Found paused batch with all ${conflicting.results.length} beads completed. Auto-resuming for build check + review + PR.\n` +
                `Batch: ${conflicting.batchId}\nBranch: ${conflicting.branch}`
            });
          }
        }

        return JSON.stringify({
          message: `Found existing batch for this project:\n` +
            `  Status: ${conflicting.status}\n` +
            `  Done: ${conflicting.results.filter(r => r.status === 'completed').length}/${conflicting.beadOrder.length}\n` +
            `  Branch: ${conflicting.branch}\n` +
            `  Notion: ${notionLogger.pageUrl(conflicting.notionPageId)}\n\n` +
            `To continue: "resume batch ${conflicting.batchId}"\nTo start fresh: tell me to "unstick" it first.`
        });
      }

      // Guard 2: Check for beads already in_review
      const inReviewIds: string[] = [];
      for (const bead of beads) {
        try {
          const { stdout } = await execAsync(
            `${process.env.HOME}/.local/bin/bd show ${bead.id} --json`,
            { cwd: project.localPath }
          );
          const parsed = JSON.parse(stdout);
          const b = Array.isArray(parsed) ? parsed[0] : parsed;
          if (b.status === 'in_review') inReviewIds.push(bead.id);
        } catch { /* skip */ }
      }
      if (inReviewIds.length === beads.length) {
        return JSON.stringify({
          message: `All ${inReviewIds.length} beads are already in in_review status.\nWork complete from a previous run.\n\nTo push: use ios_push_branch\nTo re-run: reopen the beads first.`
        });
      }
      if (inReviewIds.length > 0) {
        beads = beads.filter(b => !inReviewIds.includes(b.id));
        orderedIds = resolveBatchOrder(beads);
      }

      const batchId = `batch-${project.id}-${Date.now()}`;
      const sessionId = `ios-batch-${project.id}-${Date.now()}`;
      const date = new Date().toISOString().split('T')[0];

      // Ensure repo is ready (pulls latest on main localPath)
      await ensureRepo(project);

      // Branch name — worktree creation in runBatchAsync handles git checkout
      const branchName = (input.branch_name as string) || `feature/batch-${input.label ?? orderedIds[0]}-${date}`;

      // Create Notion page — routes to project-specific batch logs parent
      const pageId = await notionLogger.createBatchPage(
        `${project.name} — Batch: ${input.label ?? orderedIds.join(', ')}`,
        `Batch ID: ${batchId}\nBeads: ${orderedIds.join(', ')}\nBranch: ${branchName}`,
        project
      );
      if (!pageId) {
        console.error(`[ios_start_batch] Notion page creation failed for batch ${batchId}`);
        await sendGuardedIMessage(ISAIAH,
          `Warning: Notion page creation failed for batch ${batchId}. Batch will proceed but Notion logging will be unavailable.`
        );
      }
      await notionLogger.logTimelineEvent(pageId, 'running', `Batch queued: ${orderedIds.length} bead(s)`);

      // Build and save batch state
      const state: BatchState = {
        batchId,
        projectId: project.id,
        branch: branchName,
        notionPageId: pageId,
        sessionId,
        status: 'queued',
        beadOrder: orderedIds,
        currentIndex: 0,
        results: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        overnight: !(input.interactive as boolean),
        label: (input.label as string) ?? undefined,
      };
      await saveBatchState(state);

      executionLogger.log({ event: 'batch_started', project: project.id, sessionId, beadIds: orderedIds });

      // Fire-and-forget
      runBatchAsync(state, project, sessionId).catch(async (err) => {
        state.status = 'failed';
        await saveBatchState(state);
        executionLogger.log({ event: 'batch_failed', project: project.id, sessionId, error: String(err) });
        await sendGuardedIMessage(ISAIAH,
          `Batch ${batchId} crashed: ${String(err).slice(0, 200)}\nNotion: ${notionLogger.pageUrl(pageId)}`
        );
      });

      const notionUrl = notionLogger.pageUrl(pageId);
      return JSON.stringify({
        message: `Batch started: ${orderedIds.length} bead(s) on branch ${branchName}. Running autonomously.`,
        batch_id: batchId,
        notion: notionUrl,
        branch: branchName,
        bead_order: orderedIds,
      });
    }

    case 'ios_queue': {
      const batches = await getActiveBatches();
      if (batches.length === 0) {
        return JSON.stringify({ message: 'No active batches.' });
      }

      const summaries = batches.map(b => {
        const completed = b.results.filter(r => r.status === 'completed').length;
        const failed = b.results.filter(r => r.status === 'failed').length;
        const currentBead = b.beadOrder[b.currentIndex] ?? 'done';
        return {
          batch_id: b.batchId,
          project: b.projectId,
          status: b.status,
          progress: `${completed}/${b.beadOrder.length} done, ${failed} failed`,
          current_bead: currentBead,
          branch: b.branch,
          worktree: b.worktreePath ?? 'main',
        };
      });

      return JSON.stringify({ active_batches: summaries });
    }

    case 'shell_exec': {
      try {
        const result = await shellExec(input.command as string, {
          cwd: input.cwd as string | undefined,
          timeoutMs: input.timeout_ms as number | undefined
        });
        return JSON.stringify({
          exitCode: result.exitCode,
          stdout: result.stdout.slice(0, 2000),
          stderr: result.stderr.slice(0, 500),
          success: result.exitCode === 0
        });
      } catch (err: any) {
        return JSON.stringify({
          error: err.message,
          success: false
        });
      }
    }

    case 'ios_resume_batch': {
      if (!isAutonomousBatchEnabled()) return JSON.stringify({ error: BATCH_DISABLED_MESSAGE });
      let batchState: BatchState | null = null;

      if (input.batch_id) {
        batchState = await getBatchState(input.batch_id as string);
      } else if (input.project_id) {
        // Find most recent resumable batch for this project
        const all = await getActiveBatches();
        const resumable = all
          .filter(b => b.projectId === (input.project_id as string) && ['paused', 'failed', 'running'].includes(b.status))
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        batchState = resumable[0] ?? null;
      }

      if (!batchState) {
        return JSON.stringify({ error: input.batch_id
          ? `Batch not found: ${input.batch_id}`
          : `No resumable batch found for project: ${input.project_id}` });
      }

      // Auto-advance: if status is 'running' but all beads are done, this is stale state
      const completedCount = batchState.results.filter(r => r.status === 'completed').length;
      if (batchState.status === 'running' && completedCount === batchState.beadOrder.length && completedCount > 0) {
        batchState.status = 'paused';
        batchState.currentIndex = batchState.beadOrder.length;
        await saveBatchState(batchState);

        const project = getProject(batchState.projectId);
        if (!project) return JSON.stringify({ error: `Unknown project: ${batchState.projectId}` });

        const sessionId = `resume-${batchState.batchId}-${Date.now()}`;
        executionLogger.log({ event: 'batch_auto_advanced', batchId: batchState.batchId, project: project.id, sessionId });

        runBatchAsync(batchState, project, sessionId).catch(async (err) => {
          batchState.status = 'failed';
          await saveBatchState(batchState);
          await sendGuardedIMessage(ISAIAH,
            `Batch ${batchState.batchId} crashed on resume: ${String(err).slice(0, 200)}\nNotion: ${notionLogger.pageUrl(batchState.notionPageId)}`
          );
        });

        return JSON.stringify({
          message: `Batch ${batchState.batchId} has all ${completedCount} beads complete but was stuck in 'running'. Advancing to build check + review + push approval.`,
          batch_id: batchState.batchId,
          notion: notionLogger.pageUrl(batchState.notionPageId),
          branch: batchState.branch,
        });
      }

      if (!['paused', 'failed'].includes(batchState.status)) {
        return JSON.stringify({ error: `Batch ${batchState.batchId} is ${batchState.status} — can only resume paused or failed batches.` });
      }

      const project = getProject(batchState.projectId);
      if (!project) return JSON.stringify({ error: `Unknown project: ${batchState.projectId}` });

      batchState.status = 'queued';
      await saveBatchState(batchState);

      const sessionId = `resume-${batchState.batchId}-${Date.now()}`;
      executionLogger.log({ event: 'batch_resumed', batchId: batchState.batchId, project: project.id, sessionId });

      runBatchAsync(batchState, project, sessionId).catch(async (err) => {
        batchState.status = 'failed';
        await saveBatchState(batchState);
        executionLogger.log({ event: 'batch_failed', project: project.id, sessionId, error: String(err) });
        await sendGuardedIMessage(ISAIAH,
          `Batch ${batchState.batchId} crashed on resume: ${String(err).slice(0, 200)}\nNotion: ${notionLogger.pageUrl(batchState.notionPageId)}`
        );
      });

      return JSON.stringify({
        message: `Resuming batch ${batchState.batchId} from bead ${batchState.currentIndex + 1}/${batchState.beadOrder.length}.`,
        batch_id: batchState.batchId,
        notion: notionLogger.pageUrl(batchState.notionPageId),
        branch: batchState.branch,
      });
    }

    case 'ios_push_branch': {
      const project = getProject(input.project_id as string);
      if (!project) return JSON.stringify({ error: `Unknown project: ${input.project_id}` });

      let branch = input.branch as string | undefined;
      let batchState: BatchState | null = null;
      if (!branch && input.batch_id) {
        batchState = await getBatchState(input.batch_id as string);
        branch = batchState?.branch;
      }
      if (!branch) return JSON.stringify({ error: 'Provide branch or batch_id.' });

      // Ensure repo is up to date
      await ensureRepo(project);

      const pushSession: TaskSession = {
        sessionId: `push-${branch}-${Date.now()}`,
        beadId: `push-${branch}`,
        taskName: `Push ${branch}`,
        notionPageId: batchState?.notionPageId ?? '',
        startedAt: new Date(),
        phases: [],
      };

      const approved = await waitForApproval(pushSession,
        `Commits on origin/${branch}. Approve PR creation for ${project.name}?`
      );

      if (approved) {
        // Push if not already on origin
        await execAsync(`git -C ${project.localPath} push origin ${branch}`).catch(() => {});

        const prTitle = (input.title as string) || `${project.name} — ${branch}`;
        const prUrl = await createDraftPR(project.localPath, prTitle, `Branch: ${branch}\n\nAuto-generated by Justice.`);

        return JSON.stringify({ message: `PR created: ${prUrl}`, pr_url: prUrl });
      }
      return JSON.stringify({ message: 'Push declined.' });
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
  const TZ = process.env.JUSTICE_TIMEZONE ?? 'America/Chicago';
  const now = new Date();

  // Today and tomorrow in CT
  const todayISO = now.toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
  const todayDow = now.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long' });
  const currentTime = now.toLocaleTimeString('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true });
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
    `Current date and time: ${todayDow}, ${todayISO} at ${currentTime} (${TZ})`,
    `Tomorrow: ${tomorrowDow}, ${tomorrowISO}`,
    `This coming Monday: ${nextMondayISO}`,
    `This coming Friday: ${nextFridayISO}`,
    `When someone says "today", "this afternoon", "tonight", or "tomorrow", always calculate relative to the date/time above.`,
    `Never schedule in the past. If a time today has already passed, ask if they mean tomorrow.`,
    `Always use ISO format with timezone for proposed_time: e.g. ${todayISO}T19:30:00 for 7:30 PM today.`,
  ].join('\n');

  const systemPrompt = await buildSystemPrompt(callerIdentity, dateContext);

  // Build API messages from conversation history
  // Prefix each prior plain-text message with its timestamp so the model knows
  // HOW OLD it is. Without this, stale history replayed under today's date
  // context caused mis-dated scheduling (e.g. "next month" → a future year).
  // Only string content is annotated; structured tool_use/tool_result blocks
  // are passed through untouched.
  const apiMessages: Array<{ role: string; content: unknown }> = conversationHistory.map(msg => ({
    role: msg.role,
    content: typeof msg.content === 'string' && msg.timestamp
      ? `[${msg.timestamp}] ${msg.content}`
      : msg.content,
  }));

  // Add the new user message
  apiMessages.push({ role: 'user', content: messageText });

  let finalText = '';
  let rounds = 0;
  const MAX_ROUNDS = 5;

  while (rounds < MAX_ROUNDS) {
    rounds++;

    let data: Record<string, unknown>;
    const MAX_RETRIES = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
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
            max_tokens: 4096,
            system: systemPrompt,
            tools: TOOL_DEFINITIONS,
            messages: apiMessages,
          }),
        });

        if (response.ok) {
          data = await response.json() as Record<string, unknown>;
          break;
        }

        // Retry on 500/529 (server error / overloaded)
        const status = response.status;
        const body = await response.text().catch(() => '');
        console.error(`[conversational-engine] Claude API error ${status} (attempt ${attempt}/${MAX_RETRIES}): ${body.slice(0, 200)}`);

        if ((status >= 500 || status === 429) && attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, attempt * 2000));
          continue;
        }

        return { response: 'Failed to reach Claude API. Try again in a moment.', updatedHistory: conversationHistory };
      } catch (error) {
        lastError = error;
        console.error(`[conversational-engine] Claude API request failed (attempt ${attempt}/${MAX_RETRIES}):`, error);
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, attempt * 2000));
          continue;
        }
        return { response: 'Failed to reach Claude API. Try again in a moment.', updatedHistory: conversationHistory };
      }
    }
    // @ts-expect-error data assigned in loop above
    if (!data) {
      console.error('[conversational-engine] All retries exhausted:', lastError);
      return { response: 'Failed to reach Claude API after retries. Try again in a moment.', updatedHistory: conversationHistory };
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
