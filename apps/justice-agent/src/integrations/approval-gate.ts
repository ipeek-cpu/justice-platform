/**
 * Approval Gate — Redis-backed threaded approval system.
 *
 * Each approval request gets a short stamp [APPROVAL-XXX] so Isaiah
 * can reply "yes XXX" or "no XXX" to target a specific request.
 * Plain "YES"/"NO" resolves the most recent pending approval as fallback.
 *
 * Redis keys:
 *   justice:approval:{id}        → JSON { question, sessionId, status, createdAt }
 *   justice:approval:latest      → most recent approval ID (for bare YES/NO fallback)
 */

import { getRedis } from './redis-client';
import { randomBytes } from 'crypto';

const APPROVAL_PREFIX = 'justice:approval:';
const LATEST_KEY = `${APPROVAL_PREFIX}latest`;
const APPROVAL_TTL = 24 * 60 * 60; // 24 hours

export interface PendingApproval {
  id: string;
  question: string;
  sessionId: string;
  status: 'PENDING' | 'YES' | 'NO';
  createdAt: string;
  phone?: string;
}

/** Generate a short 3-char hex stamp. */
function generateStamp(): string {
  return randomBytes(2).toString('hex').slice(0, 3).toUpperCase();
}

/** Create a new pending approval and return its stamp. */
export async function createApproval(sessionId: string, question: string, phone?: string): Promise<string> {
  const redis = getRedis();
  const id = generateStamp();
  const approval: PendingApproval = {
    id,
    question,
    sessionId,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
    ...(phone ? { phone } : {}),
  };
  await redis.set(`${APPROVAL_PREFIX}${id}`, JSON.stringify(approval), 'EX', APPROVAL_TTL);
  await redis.set(LATEST_KEY, id, 'EX', APPROVAL_TTL);
  console.log(`[approval-gate] Created approval ${id}: ${question.slice(0, 80)}`);
  return id;
}

/** Resolve an approval by ID. Returns true if found and updated. */
export async function resolveApproval(id: string, decision: 'YES' | 'NO'): Promise<boolean> {
  const redis = getRedis();
  const key = `${APPROVAL_PREFIX}${id}`;
  const raw = await redis.get(key);
  if (!raw) return false;

  const approval: PendingApproval = JSON.parse(raw);
  if (approval.status !== 'PENDING') return false;

  approval.status = decision;
  await redis.set(key, JSON.stringify(approval), 'EX', APPROVAL_TTL);
  console.log(`[approval-gate] Resolved ${id} → ${decision}`);
  return true;
}

/** Get the status of an approval by ID. */
export async function getApproval(id: string): Promise<PendingApproval | null> {
  const redis = getRedis();
  const raw = await redis.get(`${APPROVAL_PREFIX}${id}`);
  if (!raw) return null;
  return JSON.parse(raw);
}

/** Get the most recent pending approval ID (scans all PENDING approvals by createdAt). */
export async function getLatestApprovalId(): Promise<string | null> {
  const redis = getRedis();
  const keys = await redis.keys(`${APPROVAL_PREFIX}[0-9A-Fa-f]*`);
  if (keys.length === 0) return null;
  let latest: { id: string; createdAt: string } | null = null;
  for (const key of keys) {
    const raw = await redis.get(key);
    if (!raw) continue;
    try {
      const data: PendingApproval = JSON.parse(raw);
      if (data.status !== 'PENDING') continue;
      if (!latest || data.createdAt > latest.createdAt) {
        latest = { id: data.id, createdAt: data.createdAt };
      }
    } catch { /* skip malformed entries */ }
  }
  return latest?.id ?? null;
}

/** List all pending approvals. */
export async function listPendingApprovals(): Promise<PendingApproval[]> {
  const redis = getRedis();
  const keys = await redis.keys(`${APPROVAL_PREFIX}[0-9A-F]*`);
  const pending: PendingApproval[] = [];
  for (const key of keys) {
    const raw = await redis.get(key);
    if (!raw) continue;
    const approval: PendingApproval = JSON.parse(raw);
    if (approval.status === 'PENDING') pending.push(approval);
  }
  return pending.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Parse an inbound message for approval responses.
 * Supports multi-stamp: "yes A1B yes C2D no E3F" resolves all three.
 * Falls back to bare YES/NO targeting the most recent pending approval.
 */
export async function parseApprovalReply(
  messageText: string
): Promise<{ handled: true; results: Array<{ approvalId: string; decision: 'YES' | 'NO' }> } | { handled: false }> {
  const text = messageText.trim();
  const results: Array<{ approvalId: string; decision: 'YES' | 'NO' }> = [];

  // Multi-stamp: "yes A1B yes C2D no E3F"
  const pattern = /\b(yes|no|y|n)\s+([A-Fa-f0-9]{3})\b/gi;
  for (const match of text.matchAll(pattern)) {
    const decision = match[1].toLowerCase().startsWith('y') ? 'YES' as const : 'NO' as const;
    const id = match[2].toUpperCase();
    const resolved = await resolveApproval(id, decision);
    if (resolved) results.push({ approvalId: id, decision });
  }

  // Bare YES/NO fallback (only if no specific stamps matched)
  if (results.length === 0) {
    const bareMatch = text.match(/^(yes|no|y|n)$/i);
    if (bareMatch) {
      const decision = bareMatch[1].toLowerCase().startsWith('y') ? 'YES' as const : 'NO' as const;
      const latestId = await getLatestApprovalId();
      if (latestId) {
        const resolved = await resolveApproval(latestId, decision);
        if (resolved) results.push({ approvalId: latestId, decision });
      }
    }
  }

  return results.length > 0 ? { handled: true, results } : { handled: false };
}

/** Format an approval stamp for inclusion in messages. */
export function formatStamp(id: string): string {
  return `[APPROVAL-${id}]`;
}
