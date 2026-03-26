import { pgTable, uuid, text, integer, timestamp, jsonb, index, boolean, unique } from 'drizzle-orm/pg-core';

export const cases = pgTable('cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: text('session_id').unique(),
  callerPhone: text('caller_phone').notNull(),
  callerName: text('caller_name'),
  status: text('status').default('intake').notNull(),
  category: text('category'),
  scoredStatutes: jsonb('scored_statutes'),
  caseScore: integer('case_score'),
  summary: text('summary'),
  tenantId: text('tenant_id').default('wolf-law').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('cases_tenant_id_idx').on(table.tenantId),
  index('cases_status_idx').on(table.status),
  index('cases_created_at_idx').on(table.createdAt),
]);

export const triageSessions = pgTable('triage_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id').references(() => cases.id).notNull(),
  transcript: text('transcript'),
  intentClassification: text('intent_classification'),
  durationSeconds: integer('duration_seconds'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  assignee: text('assignee'),
  priority: text('priority').default('medium').notNull(),
  status: text('status').default('pending').notNull(),
  deadline: timestamp('deadline'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
}, (table) => [
  index('tasks_assignee_idx').on(table.assignee),
  index('tasks_status_idx').on(table.status),
]);

export const oauthTokens = pgTable('oauth_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userIdentity: text('user_identity').notNull(),
  accountEmail: text('account_email').notNull(),
  isPrimary: boolean('is_primary').default(false).notNull(),
  provider: text('provider').default('google').notNull(),
  accessToken: text('access_token').notNull(),   // encrypted
  refreshToken: text('refresh_token').notNull(),  // encrypted
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  unique('oauth_tokens_user_account_uniq').on(table.userIdentity, table.accountEmail),
]);

// --- CRM Tables (WS14) ---

export const attorneys = pgTable('attorneys', {
  id: uuid('id').primaryKey().defaultRandom(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  firmName: text('firm_name'),
  email: text('email'),
  phone: text('phone'),
  website: text('website'),
  linkedinUrl: text('linkedin_url'),
  barNumber: text('bar_number'),
  state: text('state').default('IL'),
  city: text('city'),
  practiceAreas: text('practice_areas').array(),
  statutesReferenced: text('statutes_referenced').array(),
  whistleblowerScore: integer('whistleblower_score'),
  caseTypes: text('case_types').array(),
  contingencyFee: boolean('contingency_fee'),
  firmSize: text('firm_size'),
  publiclyTradedExp: boolean('publicly_traded_exp'),
  federalCourtExp: boolean('federal_court_exp'),
  seventhCircuitExp: boolean('seventh_circuit_exp'),
  notes: text('notes'),
  source: text('source'),
  outreachStatus: text('outreach_status').default('new'),
  scottNotes: text('scott_notes'),
  lastContactedAt: timestamp('last_contacted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_attorneys_score').on(table.whistleblowerScore),
  index('idx_attorneys_state').on(table.state),
  index('idx_attorneys_outreach_status').on(table.outreachStatus),
]);

export const crmCases = pgTable('crm_cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  callerPhone: text('caller_phone'),
  callerName: text('caller_name'),
  call1Transcript: text('call_1_transcript'),
  call2Transcript: text('call_2_transcript'),
  documents: jsonb('documents'),
  factPattern: text('fact_pattern'),
  statutesTriggered: text('statutes_triggered').array(),
  viabilityScore: integer('viability_score'),
  viabilityTier: text('viability_tier'),
  elementScores: jsonb('element_scores'),
  annualIncome: integer('annual_income'),
  employerName: text('employer_name'),
  employerSize: text('employer_size'),
  publiclyTraded: boolean('publicly_traded'),
  protectedClaims: text('protected_claims').array(),
  status: text('status').default('intake'),
  attorneyIds: uuid('attorney_ids').array(),
  scottReviewed: boolean('scott_reviewed').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_crm_cases_status').on(table.status),
]);

export const outreachLog = pgTable('outreach_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  attorneyId: uuid('attorney_id').references(() => attorneys.id),
  caseId: uuid('case_id').references(() => crmCases.id),
  channel: text('channel'),
  direction: text('direction'),
  summary: text('summary'),
  outcome: text('outcome'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_outreach_log_attorney').on(table.attorneyId),
]);

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  caller: text('caller').notNull(),
  intentType: text('intent_type').notNull(),
  action: text('action').notNull(),
  result: text('result').notNull(),
  details: text('details'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('audit_log_created_at_idx').on(table.createdAt),
  index('audit_log_intent_type_idx').on(table.intentType),
]);
