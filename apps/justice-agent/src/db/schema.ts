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
