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

## Adding a new project
1. Add entry to apps/justice-agent/src/registry/ios-projects.ts
2. Text Justice: "[project] status" to trigger first clone
3. Link Notion hub page in registry entry
