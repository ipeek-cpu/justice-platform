/**
 * Notion integration for Justice executive assistant.
 * Provides workspace search, page CRUD, and database queries
 * against the Wronged.AI Notion workspace.
 */

import { Client } from '@notionhq/client';
import type { BlockObjectRequest } from '@notionhq/client/build/src/api-endpoints';

export function getClient(): Client {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error('NOTION_TOKEN not set');
  return new Client({ auth: token });
}

export async function searchNotion(query: string): Promise<{ results: Array<{ id: string; title: string; url: string }> } | { error: string }> {
  try {
    const notion = getClient();
    const response = await notion.search({ query, page_size: 10 });

    const results = response.results
      .filter((r): r is Extract<typeof r, { object: 'page' }> => r.object === 'page')
      .map(page => {
        let title = '';
        if ('properties' in page) {
          const titleProp = Object.values(page.properties).find(
            (prop): prop is Extract<typeof prop, { type: 'title' }> => prop.type === 'title'
          );
          if (titleProp && titleProp.title.length > 0) {
            title = titleProp.title.map(t => t.plain_text).join('');
          }
        }
        const url = 'url' in page ? (page as { url: string }).url : '';
        return { id: page.id, title: title || '(untitled)', url };
      });

    return { results };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Notion search failed' };
  }
}

export async function readNotionPage(pageId: string): Promise<{ title: string; content: string } | { error: string }> {
  try {
    const notion = getClient();

    // Get page metadata for title
    const page = await notion.pages.retrieve({ page_id: pageId });
    let title = '';
    if ('properties' in page) {
      const titleProp = Object.values(page.properties).find(
        (prop): prop is Extract<typeof prop, { type: 'title' }> => prop.type === 'title'
      );
      if (titleProp && titleProp.title.length > 0) {
        title = titleProp.title.map(t => t.plain_text).join('');
      }
    }

    // Get block children (page content)
    const blocks = await notion.blocks.children.list({ block_id: pageId, page_size: 100 });
    const textParts: string[] = [];

    for (const block of blocks.results) {
      const text = extractBlockText(block as Record<string, unknown>);
      if (text) textParts.push(text);
    }

    return { title: title || '(untitled)', content: textParts.join('\n') };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to read Notion page' };
  }
}

function extractBlockText(block: Record<string, unknown>): string {
  const type = block.type as string;
  const data = block[type] as { rich_text?: Array<{ plain_text: string }> } | undefined;
  if (!data?.rich_text) return '';
  return data.rich_text.map(t => t.plain_text).join('');
}

export async function createNotionPage(
  parentId: string,
  title: string,
  content: string
): Promise<{ id: string; url: string } | { error: string }> {
  try {
    const notion = getClient();
    const children: BlockObjectRequest[] = content.split('\n').filter(Boolean).map(paragraph => ({
      object: 'block' as const,
      type: 'paragraph' as const,
      paragraph: {
        rich_text: [{ type: 'text' as const, text: { content: paragraph } }],
      },
    }));

    const page = await notion.pages.create({
      parent: { page_id: parentId },
      properties: {
        title: { title: [{ text: { content: title } }] },
      },
      children,
    });

    const url = 'url' in page ? (page as { url: string }).url : '';
    return { id: page.id, url };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to create Notion page' };
  }
}

export async function appendToNotionPage(
  pageId: string,
  content: string
): Promise<{ success: boolean } | { error: string }> {
  try {
    const notion = getClient();
    const children: BlockObjectRequest[] = content.split('\n').filter(Boolean).map(paragraph => ({
      object: 'block' as const,
      type: 'paragraph' as const,
      paragraph: {
        rich_text: [{ type: 'text' as const, text: { content: paragraph } }],
      },
    }));

    await notion.blocks.children.append({ block_id: pageId, children });
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to append to Notion page' };
  }
}

export async function queryNotionDatabase(
  databaseId: string,
  filter?: Record<string, unknown>
): Promise<{ results: Array<{ id: string; properties: Record<string, string> }> } | { error: string }> {
  try {
    const notion = getClient();
    // Use the REST API directly for database queries since the SDK typing is strict
    const body: Record<string, unknown> = { page_size: 20 };
    if (filter) body.filter = filter;

    const response = await (notion as unknown as { request: (args: Record<string, unknown>) => Promise<{ results: Array<Record<string, unknown>> }> }).request({
      path: `databases/${databaseId}/query`,
      method: 'POST',
      body,
    });

    const results = response.results
      .filter((row: Record<string, unknown>) => row.object === 'page' && 'properties' in row)
      .map((row: Record<string, unknown>) => {
        const props: Record<string, string> = {};
        for (const [key, val] of Object.entries(row.properties as Record<string, Record<string, unknown>>)) {
          props[key] = extractPropertyValue(val);
        }
        return { id: row.id as string, properties: props };
      });

    return { results };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to query Notion database' };
  }
}

function extractPropertyValue(prop: Record<string, unknown>): string {
  const type = prop.type as string;
  switch (type) {
    case 'title':
    case 'rich_text': {
      const items = prop[type] as Array<{ plain_text: string }>;
      return items?.map(t => t.plain_text).join('') ?? '';
    }
    case 'number':
      return String(prop.number ?? '');
    case 'select':
      return (prop.select as { name: string } | null)?.name ?? '';
    case 'multi_select':
      return (prop.multi_select as Array<{ name: string }>)?.map(s => s.name).join(', ') ?? '';
    case 'date':
      return (prop.date as { start: string } | null)?.start ?? '';
    case 'checkbox':
      return String(prop.checkbox ?? false);
    case 'url':
      return (prop.url as string) ?? '';
    case 'status':
      return (prop.status as { name: string } | null)?.name ?? '';
    default:
      return '';
  }
}
