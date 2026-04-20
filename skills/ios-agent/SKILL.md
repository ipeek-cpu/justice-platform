# iOS Agent Skill

Justice manages all iOS projects in the theaionlab GitHub org.

## Registered projects
- hlstc: HLSTC app (SwiftUI, ~/Developer/ios/hlstc-app)
- flaggd: Flaggd app (TypeScript, ~/Developer/ios/flaggd)

## iMessage commands
[project] build          → ios_build tool
[project] clean          → ios_clean tool
[project] status         → ios_status tool
[project] pr [title]     → ios_pr tool (requires approval)
[project] review         → ios_review tool
[project] run tonight    → ios_run_overnight tool
[project] start [bead]   → ios_start_bead tool
[project] batch [label]  → ios_start_batch (all open beads with label)
[project] batch [b1] [b2]... → ios_start_batch (specific bead IDs)
[project] queue          → ios_queue (show active batch status)

## Overnight run behavior
- Processes all unblocked beads in priority order
- Commits after each successful bead
- Runs build check after each bead — stops if build breaks
- Runs review agent on full diff at end
- Creates PR draft in Notion
- Sends morning iMessage summary with Notion link
- NEVER pushes without Isaiah's explicit YES

## Build command
xcodebuild build -scheme [scheme] \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  CODE_SIGNING_ALLOWED=NO

## Beads in iOS projects
Each project uses bd for task tracking.
On first clone: bd init --stealth (local only, not pushed)
Project beads are labeled with project ID: --label [project_id]

## Review agent output format
STATUS: APPROVED | NEEDS_CHANGES | BLOCKED
CONCERNS: bullet list or "none"
SUGGESTIONS: bullet list or "none"
READY_FOR_HUMAN_REVIEW: YES | NO
SUMMARY: one sentence

## Bead completion flow
1. Phase complete + build passing
   bd update [bead] --status in_review
   executionLogger.log({ event: 'bead_in_review', beadId })
   notionLogger.logTimelineEvent(pageId, 'waiting', 'In review — awaiting push approval')

2. Log review agent findings to Notion
   - Full output in Notion task page
   - iMessage: "[bead] ready for review. [N] concerns. Check Notion: [link]. Approve push? YES/NO [stamp]"

3. On Isaiah YES:
   git push origin [branch]
   gh pr create --draft --title "[bead title]" --body "[auto-generated]" --repo [repo]
   bd close [bead] --reason "PR created: [pr_url]"
   executionLogger.log({ event: 'bead_complete', prUrl })
   notionLogger.logTimelineEvent(pageId, 'success', 'PR created: [pr_url]')
   iMessage: "PR open: [pr_url]"

4. On Isaiah NO:
   bd update [bead] --status open
   iMessage: "Push declined. Bead reopened. What should I change?"

## PR description template
```
## [bead title]
**Bead:** [bead_id]
**Branch:** [branch]
**Acceptance criteria:**
[from bead description]
**Commits:**
[git log --oneline base..HEAD]
**Review agent:** [APPROVED|NEEDS_CHANGES] — [N] concerns
[list concerns if any]
```

## Batch execution
- Runs multiple beads sequentially on ONE branch → ONE PR
- Beads are topologically sorted (Kahn's algorithm) based on deps
- Each bead: atomicClaim → runPhase → commit → buildCheck
- If build breaks mid-batch: pause, ping Isaiah, stop
- After all beads: review agent on full diff → approval → push + PR
- Batch state stored in Redis (24h TTL)
- Use `[project] queue` to check progress of active batches
- NEVER pushes without Isaiah's explicit YES

## Auto-remediation
When the review agent returns `NEEDS_CHANGES`, Justice auto-remediates before asking for push approval:

1. **Parse concerns** — each bullet is classified by severity:
   - **BLOCKER**: security, leaked secrets, credentials, tokens, passwords
   - **HIGH**: bugs, architecture issues, crashes, null/undefined, race conditions
   - **MEDIUM**: hardcoded values, committed/tracked files, dead code, unused imports
   - **LOW**: style, suggestions — logged but no fix bead created

2. **BLOCKER alert** — if any blocker exists, iMessage Isaiah immediately (before fix batch starts)

3. **Create fix beads** — one bead per BLOCKER/HIGH/MEDIUM concern, labeled `fix`, `[batchId]`, `[severity]`

4. **Run fix batch** — same branch, same Notion page, `batchId = {original}-fix{cycle}`
   - Fix batch goes through the full loop: claim → phase → commit → build check → review
   - If review still returns NEEDS_CHANGES, another fix cycle may run

5. **Max 2 cycles** — after 2 fix cycles, if concerns remain, Justice pauses and asks Isaiah for input

6. **Push approval** — only requested after APPROVED or max cycles exhausted

## Concurrent batches
Multiple batches can run simultaneously on the same project using git worktree isolation:

- Each batch gets its own worktree at `~/Developer/ios/.worktrees/{project}-{batchId}/`
- Independent HEAD, index, and working tree — no git state collisions
- Max 5 concurrent worktrees per project
- Redis mutex prevents race conditions during worktree creation
- Worktrees are cleaned up automatically on batch approval/decline/failure
- Fix cycles share the parent batch's worktree (same branch)
- Paused batches retain their worktree for resume
- `[project] queue` shows worktree path for each active batch

## Adding a new project
1. Add entry to apps/justice-agent/src/registry/ios-projects.ts
2. Text Justice: "[project] status" to trigger first clone
3. Link Notion hub page in registry entry
