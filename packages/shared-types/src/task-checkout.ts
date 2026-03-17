/**
 * Atomic Task Checkout — Redis-based locking for Claude Code subprocesses.
 *
 * Prevents two agents from working the same beadId concurrently.
 * If an agent crashes, the TTL expires and the lock auto-releases.
 */

import Redis from 'ioredis';

let redisClient: Redis | null = null;

function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  }
  return redisClient;
}

const CHECKOUT_TTL_SECONDS = 3600;
const CHECKOUT_PREFIX = 'justice:task:';

/** Atomically claim a bead. Returns true if claimed, false if already owned. */
export async function atomicClaim(beadId: string, agentId: string): Promise<boolean> {
  const redis = getRedis();
  const key = `${CHECKOUT_PREFIX}${beadId}:owner`;
  const result = await redis.set(key, agentId, 'EX', CHECKOUT_TTL_SECONDS, 'NX');
  if (result === 'OK') {
    console.log(`[checkout] ${agentId} claimed ${beadId}`);
    return true;
  }
  const owner = await redis.get(key);
  console.log(`[checkout] ${beadId} already owned by ${owner}`);
  return false;
}

/** Extend TTL — call every 15 min during long-running phases. */
export async function renewClaim(beadId: string, agentId: string): Promise<boolean> {
  const redis = getRedis();
  const key = `${CHECKOUT_PREFIX}${beadId}:owner`;
  const owner = await redis.get(key);
  if (owner !== agentId) return false;
  await redis.expire(key, CHECKOUT_TTL_SECONDS);
  return true;
}

/** Release on completion or failure — only owning agent can release. */
export async function releaseTask(beadId: string, agentId: string): Promise<void> {
  const redis = getRedis();
  const key = `${CHECKOUT_PREFIX}${beadId}:owner`;
  const owner = await redis.get(key);
  if (owner === agentId) {
    await redis.del(key);
    console.log(`[checkout] Released ${beadId}`);
  }
}

/** List all active checkouts for monitoring. */
export async function listActiveCheckouts(): Promise<Array<{ beadId: string; agentId: string }>> {
  const redis = getRedis();
  const keys = await redis.keys(`${CHECKOUT_PREFIX}*:owner`);
  const results: Array<{ beadId: string; agentId: string }> = [];
  for (const key of keys) {
    const agentId = await redis.get(key);
    const beadId = key.replace(CHECKOUT_PREFIX, '').replace(':owner', '');
    if (agentId) results.push({ beadId, agentId });
  }
  return results;
}

/** Clean up on task complete. */
export async function cleanupTask(beadId: string, agentId: string): Promise<void> {
  await releaseTask(beadId, agentId);
  console.log(`[checkout] Cleaned up ${beadId}`);
}
