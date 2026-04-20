import { exec } from 'child_process';
import { promisify } from 'util';
import { executionLogger } from './execution-logger';

const execAsync = promisify(exec);

const ALLOWED_PREFIXES = [
  'git -C',
  'git add',
  'git commit',
  'git push',
  'git rm',
  'git checkout',
  'git log',
  'git status',
  'git diff',
  'git branch',
  'git worktree',
  'git show',
  'bd ',
  'gh ',
  'xcode-select',
  'xcodebuild',
  'redis-cli',
  'echo ',
  'cat ',
  'ls ',
  'mkdir ',
  'rm -f ',
  'mv ',
  'cp ',
  'grep ',
  'find ',
  'python3 ',
  'node ',
  'doppler secrets',
  'curl ',
  'sed ',
  'chmod ',
  'touch ',
  'tail ',
  'head ',
];

const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\//,
  /rm\s+-rf\s+~/,
  />\s*\/dev\//,
  /sudo/,
  /\|\s*sh/,
  /\|\s*bash/,
  /curl.*\|\s*sh/,
  /curl.*\|\s*bash/,
  /;\s*rm/,
  /&&\s*rm\s+-rf/,
];

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
}

export async function shellExec(
  command: string,
  options: {
    cwd?: string;
    timeoutMs?: number;
  } = {}
): Promise<ShellResult> {
  const cwd = options.cwd ?? process.env.HOME + '/Developer/justice-repo';
  const timeoutMs = Math.min(options.timeoutMs ?? 30_000, 300_000);
  const trimmed = command.trim();

  // Security: check allowed prefixes
  const allowed = ALLOWED_PREFIXES.some(prefix =>
    trimmed.startsWith(prefix)
  );
  if (!allowed) {
    throw new Error(
      `Command not allowed: "${trimmed.slice(0, 50)}". ` +
      `Must start with an approved prefix.`
    );
  }

  // Security: check blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new Error(
        `Command blocked by security policy: "${trimmed.slice(0, 50)}"`
      );
    }
  }

  // Log the execution
  executionLogger.log({
    event: 'shell_exec',
    command: trimmed.slice(0, 200),
    cwd
  });

  try {
    const { stdout, stderr } = await execAsync(trimmed, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,  // 10MB
      env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` }
    });

    executionLogger.log({
      event: 'shell_exec_complete',
      command: trimmed.slice(0, 100),
      exitCode: 0,
      stdoutLength: stdout.length
    });

    return { stdout, stderr, exitCode: 0, command: trimmed };

  } catch (err: any) {
    const exitCode = err.code ?? 1;

    executionLogger.log({
      event: 'shell_exec_error',
      command: trimmed.slice(0, 100),
      exitCode,
      error: err.message?.slice(0, 200)
    });

    // Return error result rather than throwing
    // Caller decides if non-zero exit is fatal
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? err.message ?? '',
      exitCode,
      command: trimmed
    };
  }
}
