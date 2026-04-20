/**
 * Migration Number Coordinator — prevents concurrent beads from picking the same
 * migration number by atomically incrementing a Redis counter.
 */

import { getRedis } from './redis-client';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

export async function claimNextMigrationNumber(projectLocalPath: string): Promise<number> {
  const redis = getRedis();
  const projectKey = projectLocalPath.split('/').pop() ?? 'project';
  const key = `justice:migration:${projectKey}:counter`;
  const existing = await redis.get(key);
  if (!existing) {
    const highest = await getHighestMigrationNumber(projectLocalPath);
    await redis.set(key, String(highest));
  }
  return await redis.incr(key);
}

async function getHighestMigrationNumber(projectPath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ls ${projectPath}/supabase/migrations/*.sql 2>/dev/null | xargs -I{} basename {} | grep -oE '^[0-9]+' | sort -n | tail -1`
    );
    return parseInt(stdout.trim()) || 0;
  } catch { return 0; }
}

export function formatMigrationFilename(num: number, slug: string): string {
  return `${String(num).padStart(3, '0')}_${slug}.sql`;
}
