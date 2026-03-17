import { eq, sql, and, gte } from 'drizzle-orm';
import { db } from './connection';
import { cases, tasks, auditLog, oauthTokens } from './schema';
import { encrypt, decrypt } from './encryption';

// --- Cases ---

export async function createCase(data: {
  sessionId: string;
  callerPhone: string;
  callerName?: string;
  category?: string;
  summary?: string;
  tenantId?: string;
}) {
  const [row] = await db.insert(cases).values({
    ...data,
    callerPhone: encrypt(data.callerPhone),
  }).returning();
  return row;
}

export async function getCaseBySessionId(sessionId: string) {
  const [row] = await db.select().from(cases).where(eq(cases.sessionId, sessionId));
  if (!row) return null;
  return {
    ...row,
    callerPhone: decrypt(row.callerPhone),
  };
}

export async function getCaseMetrics() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [total] = await db.select({ count: sql<number>`count(*)::int` }).from(cases);
  const [today] = await db.select({ count: sql<number>`count(*)::int` }).from(cases)
    .where(gte(cases.createdAt, todayStart));
  const byStatus = await db.select({
    status: cases.status,
    count: sql<number>`count(*)::int`,
  }).from(cases).groupBy(cases.status);
  const byCategory = await db.select({
    category: cases.category,
    count: sql<number>`count(*)::int`,
  }).from(cases).groupBy(cases.category);

  return {
    total: total.count,
    today: today.count,
    byStatus,
    byCategory,
  };
}

// --- Tasks ---

export async function createTask(data: {
  title: string;
  assignee?: string;
  priority?: string;
  deadline?: Date;
  createdBy: string;
}) {
  const [row] = await db.insert(tasks).values(data).returning();
  return row;
}

export async function getTasksByAssignee(assignee: string, filter?: string) {
  const conditions = [eq(tasks.assignee, assignee)];

  if (filter === 'overdue') {
    conditions.push(eq(tasks.status, 'pending'));
    conditions.push(sql`${tasks.deadline} < now()`);
  } else if (filter === 'today') {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    conditions.push(gte(tasks.createdAt, todayStart));
  } else if (filter && filter !== 'all') {
    conditions.push(eq(tasks.status, filter));
  }

  return db.select().from(tasks).where(and(...conditions));
}

export async function completeTask(taskId: string) {
  // Support both full UUID and short ID (first 8 chars)
  const condition = taskId.length <= 8
    ? sql`${tasks.id}::text LIKE ${taskId + '%'}`
    : eq(tasks.id, taskId);

  const [row] = await db.update(tasks)
    .set({ status: 'completed', completedAt: new Date() })
    .where(condition)
    .returning();
  return row ?? null;
}

// --- OAuth Tokens ---

export async function upsertOAuthToken(data: {
  userIdentity: string;
  accountEmail: string;
  isPrimary?: boolean;
  accessToken: string;
  refreshToken: string;
  expiresAt?: Date;
}) {
  const encrypted = {
    userIdentity: data.userIdentity,
    accountEmail: data.accountEmail,
    isPrimary: data.isPrimary ?? false,
    provider: 'google' as const,
    accessToken: encrypt(data.accessToken),
    refreshToken: encrypt(data.refreshToken),
    expiresAt: data.expiresAt,
    updatedAt: new Date(),
  };

  const existing = await db.select().from(oauthTokens)
    .where(and(
      eq(oauthTokens.userIdentity, data.userIdentity),
      eq(oauthTokens.accountEmail, data.accountEmail)
    ));

  if (existing.length > 0) {
    const [row] = await db.update(oauthTokens)
      .set(encrypted)
      .where(and(
        eq(oauthTokens.userIdentity, data.userIdentity),
        eq(oauthTokens.accountEmail, data.accountEmail)
      ))
      .returning();
    return row;
  }

  const [row] = await db.insert(oauthTokens).values(encrypted).returning();
  return row;
}

function decryptTokenRow(row: typeof oauthTokens.$inferSelect) {
  return {
    ...row,
    accessToken: decrypt(row.accessToken),
    refreshToken: decrypt(row.refreshToken),
  };
}

export async function getPrimaryOAuthToken(userIdentity: string) {
  const [row] = await db.select().from(oauthTokens)
    .where(and(
      eq(oauthTokens.userIdentity, userIdentity),
      eq(oauthTokens.isPrimary, true)
    ));
  if (!row) return null;
  return decryptTokenRow(row);
}

export async function getOAuthTokenByEmail(userIdentity: string, accountEmail: string) {
  const [row] = await db.select().from(oauthTokens)
    .where(and(
      eq(oauthTokens.userIdentity, userIdentity),
      eq(oauthTokens.accountEmail, accountEmail)
    ));
  if (!row) return null;
  return decryptTokenRow(row);
}

export async function getAllOAuthTokens(userIdentity: string) {
  const rows = await db.select().from(oauthTokens)
    .where(eq(oauthTokens.userIdentity, userIdentity));
  return rows.map(decryptTokenRow);
}

// --- Pending Tasks (for morning brief) ---

export async function getPendingTasksByAssignee(assignee: string) {
  return db.select().from(tasks).where(
    and(
      eq(tasks.status, 'pending'),
      eq(tasks.assignee, assignee)
    )
  ).orderBy(sql`${tasks.deadline} ASC NULLS LAST`);
}

// --- Task Nudge Query ---

export async function getTasksNeedingNudge() {
  return db.select().from(tasks).where(
    and(
      eq(tasks.status, 'pending'),
      eq(tasks.assignee, 'isaiah'),
      sql`${tasks.deadline} IS NOT NULL`,
      sql`${tasks.deadline} <= now() + interval '7 days'`
    )
  ).orderBy(sql`${tasks.deadline} ASC`);
}

// --- Audit Log ---

export async function logAuditEntry(data: {
  caller: string;
  intentType: string;
  action: string;
  result: string;
  details?: string;
}) {
  await db.insert(auditLog).values(data);
}
