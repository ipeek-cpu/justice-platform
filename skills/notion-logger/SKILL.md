# Notion Logger

## Import
```typescript
import { notionLogger } from '../integrations/notion-logger';
import type { WorkPhase, LearnedPattern } from '../integrations/notion-logger';
```

## Task Page Lifecycle
```typescript
// 1. Create task page at start
const pageId = await notionLogger.createTaskPage("Task name", "Spec details...");

// 2. Log each phase
await notionLogger.logPhaseStart(pageId, phase);
await notionLogger.logPhaseComplete(pageId, phase, output, exitCode);

// 3. Log questions needing approval
await notionLogger.logQuestion(pageId, "Should I proceed with X?");

// 4. Log PR draft when ready
await notionLogger.logPRDraft(pageId, { branch, beadIds, phases, testCoverage });

// 5. Record pattern after completion
await notionLogger.logPattern({ taskType, estimatedComplexity, ... });
```

## iMessage Format
Short pings only — never send code blocks or long output via iMessage:
- "Phase 2 done: built API routes (45s). See Notion for details."
- "Need approval: ready to push feature/bd-12-auth. Reply YES/NO."
- "Blocked: test failure in scoring engine. See Notion log."

## Rules
- Never send code blocks via iMessage — always log to Notion first
- Always log to Notion before pinging Isaiah
- All methods are try-catch wrapped — Notion failures never crash the agent
- Keep iMessage pings under 200 characters
