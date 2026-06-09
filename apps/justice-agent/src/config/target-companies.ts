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

/** Enabled targets only (default-on unless explicitly disabled). */
export function enabledTargets(): TargetCompany[] {
  return TARGET_COMPANIES.filter((c) => c.enabled !== false);
}
