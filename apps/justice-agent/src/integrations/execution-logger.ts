/**
 * Structured JSONL logger for autonomous task execution.
 * Append-only file at ~/Developer/justice-repo/memory/execution-log.jsonl.
 */

import * as fs from 'fs';
import * as path from 'path';

const LOG_PATH = path.join(
  process.env.HOME!,
  'Developer/justice-repo/memory/execution-log.jsonl'
);

export interface ExecutionEvent {
  ts: string;
  level?: 'info' | 'warn' | 'error';
  event: string;
  beadId?: string;
  project?: string;
  sessionId?: string;
  phase?: number;
  phaseName?: string;
  success?: boolean;
  durationMs?: number;
  commitHash?: string;
  buildWarnings?: number;
  error?: string;
  reason?: string;
  [key: string]: any;
}

class ExecutionLogger {
  log(event: Omit<ExecutionEvent, 'ts'>): void {
    try {
      const entry = {
        ts: new Date().toISOString(),
        ...event,
        level: event.level ?? 'info',
      } as ExecutionEvent;
      const dir = path.dirname(LOG_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n', 'utf8');
    } catch (err) {
      console.error('[execution-logger] Failed to write:', err);
    }
  }

  readRecent(limit = 20): ExecutionEvent[] {
    try {
      if (!fs.existsSync(LOG_PATH)) return [];
      const content = fs.readFileSync(LOG_PATH, 'utf8').trim();
      if (!content) return [];
      const lines = content.split('\n');
      return lines
        .slice(-limit)
        .map((line) => {
          try { return JSON.parse(line); } catch { return null; }
        })
        .filter(Boolean) as ExecutionEvent[];
    } catch {
      return [];
    }
  }

  getActiveTasks(): ExecutionEvent[] {
    try {
      if (!fs.existsSync(LOG_PATH)) return [];
      const content = fs.readFileSync(LOG_PATH, 'utf8').trim();
      if (!content) return [];
      const lines = content.split('\n');
      const events = lines
        .map((line) => {
          try { return JSON.parse(line) as ExecutionEvent; } catch { return null; }
        })
        .filter(Boolean) as ExecutionEvent[];

      // Track claimed vs completed/failed beads
      const claimed = new Map<string, ExecutionEvent>();
      for (const e of events) {
        if (!e.beadId) continue;
        if (e.event === 'bead_claimed') {
          claimed.set(e.beadId, e);
        } else if (
          e.event === 'bead_complete' ||
          e.event === 'bead_failed' ||
          e.event === 'bead_unstuck'
        ) {
          claimed.delete(e.beadId);
        }
      }
      return Array.from(claimed.values());
    } catch {
      return [];
    }
  }

  getLastEventForProject(project: string): ExecutionEvent | null {
    try {
      if (!fs.existsSync(LOG_PATH)) return null;
      const content = fs.readFileSync(LOG_PATH, 'utf8').trim();
      if (!content) return null;
      const lines = content.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const event = JSON.parse(lines[i]) as ExecutionEvent;
          if (event.project === project) return event;
        } catch { continue; }
      }
      return null;
    } catch {
      return null;
    }
  }

  getSubprocessPid(beadId: string): number | null {
    try {
      if (!fs.existsSync(LOG_PATH)) return null;
      const content = fs.readFileSync(LOG_PATH, 'utf8').trim();
      if (!content) return null;
      const lines = content.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const event = JSON.parse(lines[i]) as ExecutionEvent;
          if (event.beadId === beadId && event.event === 'subprocess_spawned' && event.pid) {
            return event.pid as number;
          }
        } catch { continue; }
      }
      return null;
    } catch {
      return null;
    }
  }

  getLastEventForBead(beadId: string): ExecutionEvent | null {
    try {
      if (!fs.existsSync(LOG_PATH)) return null;
      const content = fs.readFileSync(LOG_PATH, 'utf8').trim();
      if (!content) return null;
      const lines = content.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const event = JSON.parse(lines[i]) as ExecutionEvent;
          if (event.beadId === beadId) return event;
        } catch { continue; }
      }
      return null;
    } catch {
      return null;
    }
  }
}

export const executionLogger = new ExecutionLogger();
