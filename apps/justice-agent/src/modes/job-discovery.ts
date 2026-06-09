/**
 * Job Discovery — sources, scores, and stores data-engineering roles for Isaiah.
 *
 * Pipeline:
 *   1. Source  — Greenhouse/Lever public JSON (tech-forward subset) +
 *                SerpAPI/Google Jobs aggregator (Workday enterprises).
 *   2. Dedup   — drop anything whose link already exists in the Notion jobs DB.
 *   3. Score   — feed each JD + resume_data.yaml to Claude (same raw fetch()
 *                pattern as nudge/morning-brief.ts) for structured extraction,
 *                a 0–100 fit score, a lane tag, and a one-line "why it fits".
 *   4. Store   — write new rows to the Notion jobs DB (JUSTICE_JOBS_DB_ID).
 *   5. State   — record lastJobDiscoveryDate in state.json.
 *
 * Delivery (runJobDigest) and apply-assist live in sibling modules. This module
 * never submits an application — it only discovers and records.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getClient } from '../integrations/notion-client';
import { readState, updateState } from '../cron/proactive-agent';
import { logAuditEntry } from '../db/queries';
import { enabledTargets, type TargetCompany, type Lane } from '../config/target-companies';

// --- Types ---

export type JobSource = 'greenhouse' | 'lever' | 'serpapi' | 'workday';
export type EmploymentType = 'FT' | 'contract' | 'unknown';

/** A posting as sourced, before Claude scoring. */
export interface RawJob {
  company: string;
  role: string;
  link: string;
  source: JobSource;
  ats: string;
  location: string;
  description: string;
  /** Lane the company defaults to; scoring may override. */
  companyLane: Lane;
  industry?: string;
}

/** A posting after Claude scoring/extraction. */
export interface ScoredJob {
  company: string;
  role: string;
  link: string;
  source: JobSource;
  ats: string;
  stack: string[];
  location: string;
  employmentType: EmploymentType;
  comp: string | null;
  fitScore: number; // 0–100
  lane: Lane;
  whyItFits: string;
}

// --- Resume context ---

function loadResumeYaml(): string {
  const explicit = process.env.RESUME_MASTER_YAML;
  const candidates = [
    explicit,
    path.resolve(process.cwd(), 'resume/resume_data.yaml'),
    path.resolve(__dirname, '../../../../resume/resume_data.yaml'),
  ].filter((p): p is string => Boolean(p));

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
    } catch {
      /* try next */
    }
  }
  console.warn('[job-discovery] resume_data.yaml not found; scoring without resume context');
  return '';
}

// --- Sourcing: Greenhouse ---

async function fetchGreenhouse(company: TargetCompany): Promise<RawJob[]> {
  if (!company.slug) return [];
  const url = `https://boards-api.greenhouse.io/v1/boards/${company.slug}/jobs?content=true`;
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      console.error(`[job-discovery] Greenhouse ${company.slug} → ${res.status}`);
      return [];
    }
    const data = (await res.json()) as { jobs?: Array<{ title: string; absolute_url: string; location?: { name?: string }; content?: string }> };
    return (data.jobs ?? []).map((j) => ({
      company: company.name,
      role: j.title,
      link: j.absolute_url,
      source: 'greenhouse' as const,
      ats: 'greenhouse',
      location: j.location?.name ?? '',
      description: decodeHtml(j.content ?? ''),
      companyLane: company.lane,
      industry: company.industry,
    }));
  } catch (err) {
    console.error(`[job-discovery] Greenhouse ${company.slug} failed:`, err);
    return [];
  }
}

// --- Sourcing: Lever ---

async function fetchLever(company: TargetCompany): Promise<RawJob[]> {
  if (!company.slug) return [];
  const url = `https://api.lever.co/v0/postings/${company.slug}?mode=json`;
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      console.error(`[job-discovery] Lever ${company.slug} → ${res.status}`);
      return [];
    }
    const data = (await res.json()) as Array<{
      text: string;
      hostedUrl: string;
      categories?: { location?: string; commitment?: string };
      descriptionPlain?: string;
    }>;
    return (data ?? []).map((j) => ({
      company: company.name,
      role: j.text,
      link: j.hostedUrl,
      source: 'lever' as const,
      ats: 'lever',
      location: j.categories?.location ?? '',
      description: j.descriptionPlain ?? '',
      companyLane: company.lane,
      industry: company.industry,
    }));
  } catch (err) {
    console.error(`[job-discovery] Lever ${company.slug} failed:`, err);
    return [];
  }
}

// --- Sourcing: SerpAPI / Google Jobs (Workday enterprises) ---

async function fetchSerpApi(company: TargetCompany): Promise<RawJob[]> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    console.warn(`[job-discovery] SERPAPI_KEY not set — skipping ${company.name}`);
    return [];
  }
  const query = company.query ?? `${company.name} data engineer`;
  const url = `https://serpapi.com/search.json?engine=google_jobs&q=${encodeURIComponent(query)}&hl=en&api_key=${apiKey}`;
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      console.error(`[job-discovery] SerpAPI ${company.name} → ${res.status}`);
      return [];
    }
    const data = (await res.json()) as {
      jobs_results?: Array<{
        title: string;
        company_name?: string;
        location?: string;
        description?: string;
        share_link?: string;
        apply_options?: Array<{ link: string }>;
        related_links?: Array<{ link: string }>;
      }>;
    };
    return (data.jobs_results ?? []).map((j) => ({
      company: j.company_name ?? company.name,
      role: j.title,
      link: j.apply_options?.[0]?.link ?? j.share_link ?? j.related_links?.[0]?.link ?? '',
      source: 'serpapi' as const,
      ats: 'workday',
      location: j.location ?? '',
      description: j.description ?? '',
      companyLane: company.lane,
      industry: company.industry,
    }));
  } catch (err) {
    console.error(`[job-discovery] SerpAPI ${company.name} failed:`, err);
    return [];
  }
}

function sourceCompany(company: TargetCompany): Promise<RawJob[]> {
  switch (company.ats) {
    case 'greenhouse':
      return fetchGreenhouse(company);
    case 'lever':
      return fetchLever(company);
    case 'workday':
    case 'serpapi':
      return fetchSerpApi(company);
    default:
      return Promise.resolve([]);
  }
}

/** Source raw postings across all enabled targets. */
export async function discoverRawJobs(): Promise<RawJob[]> {
  const targets = enabledTargets();
  if (targets.length === 0) {
    console.warn('[job-discovery] No enabled targets — confirm slugs in config/target-companies.ts');
    return [];
  }
  const batches = await Promise.all(targets.map(sourceCompany));
  const jobs = batches.flat().filter((j) => j.link && j.role);
  // De-dupe within this run by link.
  const seen = new Set<string>();
  return jobs.filter((j) => (seen.has(j.link) ? false : (seen.add(j.link), true)));
}

// --- Scoring (raw fetch() against Anthropic — mirrors nudge/morning-brief.ts) ---

const SCORING_SYSTEM = `You are Justice, screening a single job posting for Isaiah Peek, a senior data engineer.

Score fit 0–100 and extract structured fields. Apply this rubric:
- FAVOR Senior / Staff / Principal / Lead Data Engineer, Data Platform Engineer, and Analytics Engineering leadership roles.
- REWARD stack alignment: Python, SQL, dbt, Airflow/Dagster, Snowflake/Databricks/Microsoft Fabric, cloud (AWS/Azure), CI/CD.
- WEIGHT stable industries higher: financial data, asset management, insurance, healthcare data — above volatile consumer startups.
- TREAT a regulated-finance background as a differentiator, NOT a filter (don't penalize roles that don't mention it).
- PREFER remote-friendly roles.
- DE-PRIORITIZE junior roles and pure-ETL-grunt work with no platform/ownership scope.

Lane tagging:
- "stable-FT"        → full-time roles at stable/regulated employers (finance, asset mgmt, insurance, healthcare data, established data-platform vendors).
- "contract/startup" → contract/temp engagements OR roles at early-stage/volatile consumer startups.

Return ONLY a JSON object (no prose, no markdown fences) with exactly these keys:
{
  "fitScore": <integer 0-100>,
  "lane": "stable-FT" | "contract/startup",
  "employmentType": "FT" | "contract" | "unknown",
  "stack": [<technology strings found in the JD>],
  "comp": <compensation string if explicitly listed, else null>,
  "whyItFits": "<one sentence, max 160 chars, why this fits Isaiah>"
}`;

interface ScoreResult {
  fitScore: number;
  lane: Lane;
  employmentType: EmploymentType;
  stack: string[];
  comp: string | null;
  whyItFits: string;
}

async function scoreOne(raw: RawJob, resumeYaml: string): Promise<ScoreResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[job-discovery] ANTHROPIC_API_KEY not set — skipping scoring');
    return null;
  }
  const model = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6';

  const jd = raw.description.slice(0, 6000); // keep token usage bounded
  const userContent =
    `RESUME (resume_data.yaml):\n${resumeYaml.slice(0, 6000)}\n\n` +
    `JOB POSTING:\nCompany: ${raw.company}\nRole: ${raw.role}\nLocation: ${raw.location}\n` +
    `Default lane: ${raw.companyLane}${raw.industry ? `\nIndustry: ${raw.industry}` : ''}\n\nDescription:\n${jd}`;

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
        max_tokens: 400,
        system: SCORING_SYSTEM,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    if (!response.ok) {
      console.error(`[job-discovery] Claude API error: ${response.status}`);
      return null;
    }

    const result = (await response.json()) as { content: Array<{ type: string; text?: string }> };
    const text = result.content?.find((b) => b.type === 'text')?.text ?? '';
    return parseScore(text, raw);
  } catch (err) {
    console.error('[job-discovery] Claude scoring request failed:', err);
    return null;
  }
}

function parseScore(text: string, raw: RawJob): ScoreResult | null {
  // Tolerate stray prose / fences by extracting the first JSON object.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    console.error('[job-discovery] No JSON in scoring response');
    return null;
  }
  try {
    const j = JSON.parse(match[0]) as Partial<ScoreResult>;
    const fitScore = Math.max(0, Math.min(100, Math.round(Number(j.fitScore ?? 0))));
    const lane: Lane = j.lane === 'stable-FT' || j.lane === 'contract/startup' ? j.lane : raw.companyLane;
    const employmentType: EmploymentType =
      j.employmentType === 'FT' || j.employmentType === 'contract' ? j.employmentType : 'unknown';
    return {
      fitScore,
      lane,
      employmentType,
      stack: Array.isArray(j.stack) ? j.stack.map(String).slice(0, 20) : [],
      comp: typeof j.comp === 'string' && j.comp.trim() ? j.comp.trim() : null,
      whyItFits: typeof j.whyItFits === 'string' ? j.whyItFits.slice(0, 200) : '',
    };
  } catch (err) {
    console.error('[job-discovery] Failed to parse scoring JSON:', err);
    return null;
  }
}

// --- Notion storage + dedup (JUSTICE_JOBS_DB_ID) ---

/**
 * Notion jobs DB property names. The database is provisioned in Notion and its
 * id supplied via Doppler as JUSTICE_JOBS_DB_ID. Required property types:
 *   company (Title), role (Text), link (URL), source (Select), ATS (Select),
 *   fit_score (Number), lane (Select), "contract/FT" (Select), stack (Text),
 *   location (Text), date_found (Date),
 *   status (Status: new | reviewing | applied | passed), why_it_fits (Text)
 */
const PROP = {
  company: 'company',
  role: 'role',
  link: 'link',
  source: 'source',
  ats: 'ATS',
  fitScore: 'fit_score',
  lane: 'lane',
  contractFT: 'contract/FT',
  stack: 'stack',
  location: 'location',
  dateFound: 'date_found',
  status: 'status',
  whyItFits: 'why_it_fits',
} as const;

function getJobsDbId(): string | null {
  return process.env.JUSTICE_JOBS_DB_ID ?? null;
}

/** Fetch every existing posting link in the jobs DB (paginated) for dedup. */
export async function fetchExistingLinks(dbId: string): Promise<Set<string>> {
  const notion = getClient();
  const links = new Set<string>();
  let cursor: string | undefined;
  try {
    do {
      const body: Record<string, unknown> = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const resp = (await (notion as unknown as { request: (a: Record<string, unknown>) => Promise<{ results: Array<Record<string, any>>; has_more: boolean; next_cursor: string | null }> }).request({
        path: `databases/${dbId}/query`,
        method: 'POST',
        body,
      }));
      for (const row of resp.results) {
        const url = row.properties?.[PROP.link]?.url as string | undefined;
        if (url) links.add(url);
      }
      cursor = resp.has_more ? resp.next_cursor ?? undefined : undefined;
    } while (cursor);
  } catch (err) {
    console.error('[job-discovery] fetchExistingLinks failed:', err);
  }
  return links;
}

async function writeJobRow(dbId: string, job: ScoredJob, dateFound: string): Promise<void> {
  const notion = getClient();
  const text = (s: string) => [{ type: 'text' as const, text: { content: s.slice(0, 1900) } }];
  await notion.pages.create({
    parent: { database_id: dbId },
    properties: {
      [PROP.company]: { title: text(job.company) },
      [PROP.role]: { rich_text: text(job.role) },
      [PROP.link]: { url: job.link || null },
      [PROP.source]: { select: { name: job.source } },
      [PROP.ats]: { select: { name: job.ats } },
      [PROP.fitScore]: { number: job.fitScore },
      [PROP.lane]: { select: { name: job.lane } },
      [PROP.contractFT]: { select: { name: job.employmentType } },
      [PROP.stack]: { rich_text: text(job.stack.join(', ')) },
      [PROP.location]: { rich_text: text(job.location) },
      [PROP.dateFound]: { date: { start: dateFound } },
      [PROP.status]: { status: { name: 'new' } },
      [PROP.whyItFits]: { rich_text: text(job.whyItFits) },
    } as Record<string, unknown>,
  } as unknown as Parameters<typeof notion.pages.create>[0]);
}

// --- Orchestrator ---

export interface JobDiscoveryRunResult {
  sourced: number;
  newAfterDedup: number;
  scored: ScoredJob[];
  stored: number;
}

/**
 * Full discovery pass: source → dedup → score → store → record state.
 * Safe to call with no JUSTICE_JOBS_DB_ID (scores in-memory, stores nothing).
 */
export async function runJobDiscovery(): Promise<JobDiscoveryRunResult> {
  const resumeYaml = loadResumeYaml();
  const sourced = await discoverRawJobs();

  const dbId = getJobsDbId();
  const existing = dbId ? await fetchExistingLinks(dbId) : new Set<string>();
  const fresh = sourced.filter((j) => !existing.has(j.link));

  const scored: ScoredJob[] = [];
  for (const raw of fresh) {
    const s = await scoreOne(raw, resumeYaml);
    if (!s) continue;
    scored.push({
      company: raw.company,
      role: raw.role,
      link: raw.link,
      source: raw.source,
      ats: raw.ats,
      stack: s.stack,
      location: raw.location,
      employmentType: s.employmentType,
      comp: s.comp,
      fitScore: s.fitScore,
      lane: s.lane,
      whyItFits: s.whyItFits,
    });
  }
  scored.sort((a, b) => b.fitScore - a.fitScore);

  let stored = 0;
  if (dbId) {
    const dateFound = new Date().toISOString().split('T')[0];
    for (const job of scored) {
      try {
        await writeJobRow(dbId, job, dateFound);
        stored++;
      } catch (err) {
        console.error(`[job-discovery] writeJobRow failed for ${job.company} / ${job.role}:`, err);
      }
    }
  } else {
    console.warn('[job-discovery] JUSTICE_JOBS_DB_ID not set — scored but not stored');
  }

  updateState('lastJobDiscoveryDate', new Date().toISOString());

  logAuditEntry({
    caller: 'system',
    intentType: 'job_discovery',
    action: 'discovery_run',
    result: 'success',
    details: `sourced: ${sourced.length}, new: ${fresh.length}, scored: ${scored.length}, stored: ${stored}`,
  }).catch((err) => console.error('[job-discovery] Audit log failed:', err));

  return { sourced: sourced.length, newAfterDedup: fresh.length, scored, stored };
}

export function getLastJobDiscoveryDate(): string | null {
  try {
    return readState().lastJobDiscoveryDate ?? null;
  } catch {
    return null;
  }
}

// Minimal HTML entity / tag stripper for Greenhouse `content` (HTML-encoded).
function decodeHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
