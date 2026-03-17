# Code Execution

## Import
```typescript
import { runPhase, waitForApproval, requestGitPush } from '../modes/code-executor';
import type { PhaseResult, TaskSession } from '../modes/code-executor';
```

## Phase Execution
```typescript
const result = await runPhase(session, {
  number: 1,
  id: 'read-codebase',
  name: 'Read and understand codebase',
  prompt: 'Read all files in src/auth/ and summarize the authentication flow',
  workingDir: '/Users/justicewolf/Developer/justice-repo',
});
```

## Approval Gates
Mandatory approval required for:
- After every phase completion (built into `runPhase`)
- Before git push: `await requestGitPush(session, branch, prDraft)`
- Before new dependencies: `await waitForApproval(session, "Install package X?")`
- Before file deletion: `await waitForApproval(session, "Delete old-file.ts?")`

## Branch Strategy
- Branch name: `feature/[bead-id]-[short-name]`
- Example: `feature/bd-12-auth-middleware`
- Never commit directly to main

## Rules
- Never auto-push — always use `requestGitPush` which requires approval
- Never install packages without approval via `waitForApproval`
- Never delete files without approval
- Approval polls Redis every 5s with 24h timeout
- All phase output is logged to Notion automatically
