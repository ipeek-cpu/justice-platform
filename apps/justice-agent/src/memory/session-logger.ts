import * as fs from 'fs';
import * as path from 'path';

const MEMORY_DIR = path.join(process.env.HOME!, 'Developer/justice-repo/memory');
const MEMORY_FILE = path.join(MEMORY_DIR, 'MEMORY.md');

export interface SessionLog {
  date: string;
  whatHappened: string[];
  decisions: string[];
  bdReadyOutput: string;
  patternsLearned: string[];
  blockers: string[];
}

export function writeSessionLog(log: SessionLog): void {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  const filename = path.join(MEMORY_DIR, `${log.date}.md`);
  const content = [
    `# Justice Session — ${log.date}`,
    '',
    '## What happened',
    ...log.whatHappened.map(s => `- ${s}`),
    '',
    '## Decisions made',
    ...log.decisions.map(s => `- ${s}`),
    '',
    '## Blockers',
    ...log.blockers.map(s => `- ${s}`),
    '',
    '## Patterns learned',
    ...log.patternsLearned.map(s => `- ${s}`),
    '',
    '## bd ready output (session end)',
    '```',
    log.bdReadyOutput,
    '```',
  ].join('\n');
  fs.writeFileSync(filename, content, 'utf8');
}

// Read the last N session logs for context injection
export function readRecentSessions(n = 7): string {
  if (!fs.existsSync(MEMORY_DIR)) return '';
  const files = fs.readdirSync(MEMORY_DIR)
    .filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.md$/))
    .sort()
    .reverse()
    .slice(0, n);
  return files.map(f =>
    fs.readFileSync(path.join(MEMORY_DIR, f), 'utf8')
  ).join('\n\n---\n\n');
}

// Read MEMORY.md — curated long-term memory
export function readLongTermMemory(): string {
  if (!fs.existsSync(MEMORY_FILE)) return '';
  return fs.readFileSync(MEMORY_FILE, 'utf8');
}

// Append an important fact to MEMORY.md
export function appendToMemory(fact: string): void {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  const line = `- ${new Date().toISOString().split('T')[0]}: ${fact}\n`;
  fs.appendFileSync(MEMORY_FILE, line, 'utf8');
}
