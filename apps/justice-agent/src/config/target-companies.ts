/**
 * Target-company registry for the job-discovery pipeline.
 *
 * Dual-path sourcing:
 *   - 'greenhouse' / 'lever' → fetched directly from the company's public board JSON
 *     (tech-forward subset; fast, structured, no API key).
 *   - 'workday' / 'serpapi'  → sourced via the SerpAPI Google Jobs aggregator, since
 *     Workday-based enterprises don't expose a clean public board JSON.
 *
 * SCAFFOLD: slugs/queries below are placeholders. Isaiah confirms the real
 * board slugs before the first live run. Flip `enabled: false` to park an entry
 * without deleting it.
 *
 * Board JSON endpoints (for reference):
 *   Greenhouse: https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
 *   Lever:      https://api.lever.co/v0/postings/{slug}?mode=json
 */

import * as fs from 'fs';
import * as path from 'path';

export type ATS = 'greenhouse' | 'lever' | 'workday' | 'serpapi';

/** Lane the company's roles default into; per-role scoring can still re-tag. */
export type Lane = 'stable-FT' | 'contract/startup';

export interface TargetCompany {
  /** Display name used in digests and Notion rows. */
  name: string;
  /** Which sourcing path to use. */
  ats: ATS;
  /**
   * Board token / slug used in the public JSON URL.
   * Required for 'greenhouse' and 'lever'. Ignored for 'workday'/'serpapi'.
   */
  slug?: string;
  /**
   * Explicit Google Jobs query for the 'workday'/'serpapi' path.
   * Defaults to `"<name> data engineer"` when omitted.
   */
  query?: string;
  /** Default lane for this company's roles. */
  lane: Lane;
  /** Industry hint — feeds the scoring rubric (stable industries weighted up). */
  industry?: string;
  /** Set false to skip without deleting the entry. Defaults to true. */
  enabled?: boolean;
}

/**
 * Tech-forward subset → Greenhouse/Lever public JSON.
 * Stable-leaning data/finance employers are tagged stable-FT; the rest
 * default to contract/startup and rely on per-role scoring to re-tag.
 */
export const GREENHOUSE_LEVER_TARGETS: TargetCompany[] = [
  // --- SCAFFOLD: confirm slugs ---
  { name: 'Stripe', ats: 'greenhouse', slug: 'stripe', lane: 'stable-FT', industry: 'financial data', enabled: false },
  { name: 'Databricks', ats: 'greenhouse', slug: 'databricks', lane: 'stable-FT', industry: 'data platform', enabled: false },
  { name: 'Snowflake', ats: 'greenhouse', slug: 'snowflake', lane: 'stable-FT', industry: 'data platform', enabled: false },
  { name: 'dbt Labs', ats: 'lever', slug: 'dbtlabs', lane: 'contract/startup', industry: 'data tooling', enabled: false },
];

/**
 * Workday-based enterprises (stable industries: asset mgmt, insurance,
 * financial data, healthcare data) → SerpAPI / Google Jobs aggregator.
 */
export const WORKDAY_ENTERPRISE_TARGETS: TargetCompany[] = [
  // --- SCAFFOLD: confirm queries/companies ---
  { name: 'Northern Trust', ats: 'serpapi', query: 'Northern Trust senior data engineer', lane: 'stable-FT', industry: 'asset management', enabled: false },
  { name: 'Morningstar', ats: 'serpapi', query: 'Morningstar data platform engineer', lane: 'stable-FT', industry: 'financial data', enabled: false },
  { name: 'Blue Cross Blue Shield', ats: 'serpapi', query: 'Blue Cross Blue Shield data engineer', lane: 'stable-FT', industry: 'healthcare data', enabled: false },
];

export const TARGET_COMPANIES: TargetCompany[] = [
  ...GREENHOUSE_LEVER_TARGETS,
  ...WORKDAY_ENTERPRISE_TARGETS,
];

/**
 * Runtime-editable targets, seeded ad hoc (e.g. via the seed_job_target tool)
 * with NO code change. Stored as JSON in memory/ (gitignored) and merged into
 * enabledTargets(), so a newly-seeded company is sourced on the next run.
 */
const DYNAMIC_TARGETS_FILE = path.join(
  process.env.HOME!,
  'Developer/justice-repo/memory/job-targets.json',
);

export function loadDynamicTargets(): TargetCompany[] {
  try {
    if (!fs.existsSync(DYNAMIC_TARGETS_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(DYNAMIC_TARGETS_FILE, 'utf8'));
    return Array.isArray(raw) ? (raw as TargetCompany[]) : [];
  } catch {
    return [];
  }
}

function targetKey(c: TargetCompany): string {
  return `${c.ats}:${(c.slug ?? c.query ?? c.name).toLowerCase()}`;
}

/** Append a target to the runtime store. Idempotent on (ats, slug|query|name). */
export function addDynamicTarget(t: TargetCompany): { added: boolean; reason?: string } {
  const dynamic = loadDynamicTargets();
  const key = targetKey(t);
  if (dynamic.some((d) => targetKey(d) === key) || TARGET_COMPANIES.some((c) => targetKey(c) === key)) {
    return { added: false, reason: 'already tracked' };
  }
  dynamic.push(t);
  fs.mkdirSync(path.dirname(DYNAMIC_TARGETS_FILE), { recursive: true });
  fs.writeFileSync(DYNAMIC_TARGETS_FILE, JSON.stringify(dynamic, null, 2), 'utf8');
  return { added: true };
}

/** Enabled targets only — static registry + runtime-seeded (default-on unless disabled). */
export function enabledTargets(): TargetCompany[] {
  return [...TARGET_COMPANIES, ...loadDynamicTargets()].filter((c) => c.enabled !== false);
}
