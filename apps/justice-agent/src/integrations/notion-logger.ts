/**
 * Notion structured logger for Justice autonomous agent.
 * Logs task progress, phase results, questions, PR drafts, and learned patterns.
 * All methods are wrapped in try-catch — Notion failures never crash the agent.
 */

import type { BlockObjectRequest } from '@notionhq/client/build/src/api-endpoints';
import { getClient } from './notion-client';

export interface WorkPhase {
  number: number;
  id: string;
  name: string;
  prompt: string;
  workingDir?: string;
}

export interface LearnedPattern {
  taskType: string;
  estimatedComplexity: string;
  estimatedDuration: string;
  actualDuration: string;
  estimationAccuracy: number;
  phasesCompleted: number;
  phasesRetried: number;
  toolsUsed: string[];
  whatWorked: string;
  whatFailed: string;
  reusablePattern: string;
  complexitySignals: string[];
  projectContext?: string;
}

class NotionLogger {
  async createTaskPage(taskName: string, spec: string, overrideParentId?: string): Promise<string> {
    try {
      const notion = getClient();
      const parentId = overrideParentId ?? process.env.JUSTICE_PARENT_PAGE_ID;
      if (!parentId) {
        console.error('[notion-logger] JUSTICE_PARENT_PAGE_ID not set');
        return '';
      }

      const children: BlockObjectRequest[] = [
        {
          object: 'block' as const,
          type: 'heading_2' as const,
          heading_2: {
            rich_text: [{ type: 'text' as const, text: { content: 'Spec' } }],
          },
        },
        {
          object: 'block' as const,
          type: 'paragraph' as const,
          paragraph: {
            rich_text: [{ type: 'text' as const, text: { content: spec.slice(0, 2000) } }],
          },
        },
        {
          object: 'block' as const,
          type: 'heading_2' as const,
          heading_2: {
            rich_text: [{ type: 'text' as const, text: { content: 'Progress Log' } }],
          },
        },
      ];

      const page = await notion.pages.create({
        parent: { page_id: parentId },
        properties: {
          title: { title: [{ text: { content: taskName } }] },
        },
        children,
      });

      return page.id;
    } catch (err) {
      console.error('[notion-logger] createTaskPage failed:', err);
      return '';
    }
  }

  async createBatchPage(title: string, body: string, project?: { batchLogsPageId?: string }): Promise<string> {
    const parentId =
      project?.batchLogsPageId ||
      process.env.NOTION_HLSTC_BATCH_LOGS_PAGE_ID ||  // fallback for transition
      process.env.JUSTICE_PARENT_PAGE_ID ||
      '';
    return this.createTaskPage(title, body, parentId);
  }

  async logPhaseStart(pageId: string, phase: WorkPhase): Promise<void> {
    if (!pageId) return;
    try {
      const notion = getClient();
      const children: BlockObjectRequest[] = [
        {
          object: 'block' as const,
          type: 'heading_3' as const,
          heading_3: {
            rich_text: [{ type: 'text' as const, text: { content: `Phase ${phase.number}: ${phase.name}` } }],
            color: 'blue_background' as const,
          },
        },
        {
          object: 'block' as const,
          type: 'paragraph' as const,
          paragraph: {
            rich_text: [{ type: 'text' as const, text: { content: phase.prompt.slice(0, 500) + (phase.prompt.length > 500 ? '...' : '') } }],
          },
        },
      ];

      await notion.blocks.children.append({ block_id: pageId, children });
    } catch (err) {
      console.error('[notion-logger] logPhaseStart failed:', err);
    }
  }

  async logPhaseComplete(pageId: string, phase: WorkPhase, output: string, exitCode: number): Promise<void> {
    if (!pageId) return;
    try {
      const notion = getClient();
      const success = exitCode === 0;
      const children: BlockObjectRequest[] = [
        {
          object: 'block' as const,
          type: 'callout' as const,
          callout: {
            rich_text: [{ type: 'text' as const, text: { content: `Phase ${phase.number} ${success ? 'completed' : 'failed'} (exit ${exitCode})` } }],
            icon: { type: 'emoji' as const, emoji: success ? '\u2705' : '\u274C' },
            color: success ? 'green_background' as const : 'red_background' as const,
          },
        },
        {
          object: 'block' as const,
          type: 'code' as const,
          code: {
            rich_text: [{ type: 'text' as const, text: { content: output.slice(0, 2000) } }],
            language: 'plain text' as const,
          },
        },
      ];

      await notion.blocks.children.append({ block_id: pageId, children });
    } catch (err) {
      console.error('[notion-logger] logPhaseComplete failed:', err);
    }
  }

  async logQuestion(pageId: string, question: string): Promise<void> {
    if (!pageId) return;
    try {
      const notion = getClient();
      const children: BlockObjectRequest[] = [
        {
          object: 'block' as const,
          type: 'callout' as const,
          callout: {
            rich_text: [{ type: 'text' as const, text: { content: question } }],
            icon: { type: 'emoji' as const, emoji: '\u2753' },
            color: 'yellow_background' as const,
          },
        },
      ];

      await notion.blocks.children.append({ block_id: pageId, children });
    } catch (err) {
      console.error('[notion-logger] logQuestion failed:', err);
    }
  }

  async logPRDraft(pageId: string, pr: { branch: string; beadIds: string[]; phases: number; testCoverage: string }): Promise<void> {
    if (!pageId) return;
    try {
      const notion = getClient();
      const details = [
        `Branch: ${pr.branch}`,
        `Bead IDs: ${pr.beadIds.join(', ')}`,
        `Phases completed: ${pr.phases}`,
        `Test coverage: ${pr.testCoverage}`,
      ].join('\n');

      const children: BlockObjectRequest[] = [
        {
          object: 'block' as const,
          type: 'heading_3' as const,
          heading_3: {
            rich_text: [{ type: 'text' as const, text: { content: 'PR Draft' } }],
          },
        },
        {
          object: 'block' as const,
          type: 'code' as const,
          code: {
            rich_text: [{ type: 'text' as const, text: { content: details } }],
            language: 'plain text' as const,
          },
        },
      ];

      await notion.blocks.children.append({ block_id: pageId, children });
    } catch (err) {
      console.error('[notion-logger] logPRDraft failed:', err);
    }
  }

  async logPattern(pattern: LearnedPattern): Promise<void> {
    try {
      const notion = getClient();
      const patternPageId = process.env.NOTION_PATTERN_LIBRARY_PAGE_ID;
      if (!patternPageId) {
        console.error('[notion-logger] NOTION_PATTERN_LIBRARY_PAGE_ID not set');
        return;
      }

      const children: BlockObjectRequest[] = [
        {
          object: 'block' as const,
          type: 'divider' as const,
          divider: {},
        },
        {
          object: 'block' as const,
          type: 'heading_3' as const,
          heading_3: {
            rich_text: [{ type: 'text' as const, text: { content: `${pattern.taskType} — ${pattern.estimatedComplexity}` } }],
          },
        },
        {
          object: 'block' as const,
          type: 'code' as const,
          code: {
            rich_text: [{ type: 'text' as const, text: { content: JSON.stringify(pattern, null, 2) } }],
            language: 'json' as const,
          },
        },
      ];

      await notion.blocks.children.append({ block_id: patternPageId, children });
    } catch (err) {
      console.error('[notion-logger] logPattern failed:', err);
    }
  }

  async logTimelineEvent(
    pageId: string,
    status: 'success' | 'running' | 'failed' | 'waiting',
    message: string
  ): Promise<void> {
    if (!pageId) return;
    try {
      const notion = getClient();
      const emojiMap = { success: '\u2705', running: '\uD83D\uDD04', failed: '\u274C', waiting: '\u23F3' };
      const emoji = emojiMap[status];
      const time = new Date().toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/Chicago',
      });

      const children: BlockObjectRequest[] = [
        {
          object: 'block' as const,
          type: 'paragraph' as const,
          paragraph: {
            rich_text: [{ type: 'text' as const, text: { content: `${emoji} ${time} — ${message}` } }],
          },
        },
      ];

      await notion.blocks.children.append({ block_id: pageId, children });
    } catch (err) {
      console.error('[notion-logger] logTimelineEvent failed:', err);
    }
  }

  pageUrl(pageId: string): string {
    return `https://notion.so/${pageId.replace(/-/g, '')}`;
  }
}

export const notionLogger = new NotionLogger();
