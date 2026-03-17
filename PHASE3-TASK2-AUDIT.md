# Phase 3 Task 2 — Generic iOS Agent — Audit

## TypeCheck
| Package | Status |
|---------|--------|
| `@justice/shared-types` | PASS |
| `@justice/justice-agent` | PASS (pre-existing rootDir + routing.ts warnings only) |

## Checklist
| # | Item | Status |
|---|------|--------|
| 1 | review-agent.ts compiles, parseReviewOutput handles APPROVED/NEEDS_CHANGES/BLOCKED | PASS |
| 2 | overnight-runner.ts compiles, runOvernightSession fires async | PASS |
| 3 | ios-projects.ts has xcodeSchemeName on both projects (HLSTC, flaggd) | PASS |
| 4 | All 7 iOS tools added to TOOL_DEFINITIONS (total: 33) | PASS |
| 5 | All 7 iOS tools handled in executeTool switch | PASS |
| 6 | Morning summary cron wired with America/Chicago timezone | PASS |
| 7 | skills/ios-agent/SKILL.md created | PASS |
| 8 | System prompt updated with iOS command patterns | PASS |
| 9 | TypeCheck passes (no new errors) | PASS |
| 10 | `readState` exported from proactive-agent.ts | PASS |
| 11 | `logPRDraft` phases param fixed (number, not string[]) | PASS |

## Files Created
| File | Purpose |
|------|---------|
| `apps/justice-agent/src/modes/review-agent.ts` | Review agent subprocess — parses Claude Code review output |
| `apps/justice-agent/src/modes/overnight-runner.ts` | Overnight run orchestrator — processes beads, builds, reviews, creates PR draft |
| `skills/ios-agent/SKILL.md` | iOS agent skill documentation |
| `PHASE3-TASK2-AUDIT.md` | This file |

## Files Modified
| File | Change |
|------|--------|
| `apps/justice-agent/src/registry/ios-projects.ts` | Added `xcodeSchemeName`, `notionHubUrl`; renamed `hlstc-app` → `hlstc`; reordered entries |
| `apps/justice-agent/src/modes/conversational-engine.ts` | 7 new tool defs (#27-33), 7 executeTool cases, new imports (review-agent, overnight-runner, github, atomicClaim, exec/promisify), system prompt iOS commands |
| `apps/justice-agent/src/cron/schedule.ts` | Added 7 AM CT morning summary cron; imported readState/updateState |
| `apps/justice-agent/src/cron/proactive-agent.ts` | Exported `readState` (was private) |

## Adaptation Notes
- `logPRDraft` takes `phases: number` (phase count), not `string[]`. Fixed in both overnight-runner.ts and conversational-engine.ts.
- `readState` was not exported from proactive-agent.ts — added export.
- `hlstc-app` ID renamed to `hlstc` per user spec. Only referenced in ios-projects.ts.
- `notionPageUrl` renamed to `notionHubUrl` per user spec.
- `runBuildCheck` exported from overnight-runner.ts for reuse in conversational-engine.ts.

## Tool Summary (33 total)
1-17: Original tools (case metrics, tasks, email, calendar, nudges, morning brief, Notion)
18-25: Phase 2 tools (linkedin, memory, status, code, ios_task, resume_generate, resume_batch, email_resume)
26: checkout_status (Phase 3 Task 1)
27-33: iOS agent tools (ios_build, ios_clean, ios_status, ios_pr, ios_review, ios_run_overnight, ios_start_bead)
