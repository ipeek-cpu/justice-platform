# Autonomous Batch Execution — SKILL.md

## Purpose
This skill defines the autonomous batch execution system for the Justice agent.
Isaiah texts "hlstc batch m3-sessions" and Justice runs all beads to completion
with zero interruptions, one final iMessage, and a draft PR on approval.

## Target Workflow
1. Isaiah texts batch command
2. Justice runs all beads sequentially on a single branch (worktree-isolated)
3. One intermediate push after all beads (makes commits visible to main clone)
4. Final build check on MAIN CLONE (project.localPath), never worktree
5. Review agent runs with inline diff (no subprocess git diff)
6. One iMessage summary at completion with approval stamp
7. "yes XXX" -> draft PR created, beads closed
8. "no XXX" -> beads reopened, branch preserved

## Architecture

### Overnight Mode (default)
- `BatchState.overnight = true` (default unless `interactive: true`)
- `RunPhaseOptions.silent = true` suppresses per-phase iMessage + approval stamps
- Notion timeline events still fire for all phases

### Approval System
- Multi-stamp parsing: "yes A1B yes C2D no E3F" resolves all three
- Bare YES/NO targets the most recent PENDING approval (scanned by createdAt)
- `waitForApproval` never throws — re-pings every 6 hours

### Build Checks
- Per-bead build checks REMOVED — waste time, break flow
- ONE final build check after all beads via `runFinalBuildCheck`
- Builds in the WORKTREE (branch is already checked out there)
- Never does `git checkout` on main clone — git refuses if branch is in a worktree
- Falls back to main clone only if worktree is gone and branch is not in any worktree
- Auto-fix attempt (1 cycle) on build failure
- Redis build lock prevents concurrent builds

### Subprocess Hardening
- Stale timeout: 90min normal, 120min review (phase 99)
- Exit 143 (SIGTERM) with >500 chars output = partial success
- SIGTERM retry: one automatic retry if output < 500 chars
- Progress heartbeat: Notion every 10min, iMessage every 30min (silent mode skips iMessage)

### Two-Push Model
- Push #1 (intermediate): Silent push after all beads complete, before build check
- Push #2 (final): Only if auto-fix added new commits after intermediate push

### Resume
- `ios_resume_batch` tool re-launches `runBatchAsync` from `state.currentIndex`
- If worktree missing but branch on origin: creates new worktree
- If worktree missing and branch not on origin: fails with message to Isaiah

### Migration Coordination
- `claimNextMigrationNumber()` atomically increments a Redis counter
- Execution prompt instructs Claude to check existing migration files

## Planning Checklist
Before any batch-related change, verify:

| Check | Rule |
|-------|------|
| Per-bead approval gate? | NEVER add one — `silent` flag suppresses all |
| Timeout throws? | NEVER — `waitForApproval` loops with 6h re-ping |
| Silent failure? | If `createFixBeads` returns 0 for non-LOW concerns, alert Isaiah |
| Build in worktree? | YES — build where the branch is checked out (worktree). Never `git checkout` on main clone while worktree exists. |
| Migration file? | Use `claimNextMigrationNumber` or check existing files |
| Bead title from review? | Strip markdown: no `**bold**`, backticks, quotes |
| Start without checking? | Always check for existing batches and in_review beads |
| Single approval stamp? | Use multi-stamp parser: `parseApprovalReply` handles arrays |
| Double push? | Only push final if `rev-list origin/branch..HEAD --count > 0` |
| "hlstc status" during batch? | Shows batch progress with % complete, current bead, Notion link |
| Stale running batch? | `ios_resume_batch` auto-advances if all beads completed but status stuck at `running` |
| Existing branch on worktree create? | Checks local/remote, reuses valid worktree, cleans stale dirs |

## Files
| File | Role |
|------|------|
| `batch-runner.ts` | Main loop, worktree mgmt, build check, review, PR |
| `code-executor.ts` | Subprocess spawn, silent flag, heartbeat, exit 143 |
| `approval-gate.ts` | Multi-stamp parsing, pending scan |
| `executive-webhook.ts` | Array return handling for approval results |
| `overnight-runner.ts` | `runFinalBuildCheck` (Redis lock + main clone) |
| `review-agent.ts` | Pre-filtered inline diff, title sanitization |
| `conversational-engine.ts` | Tool defs, pre-flight guards, resume/push handlers |
| `migration-coordinator.ts` | Redis-backed migration number counter |
