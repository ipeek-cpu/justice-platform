# Justice — Autonomous AI Agent Platform

> Autonomous AI agent for iOS development automation, executive assistance, and Wolf Law employment triage.

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![Node](https://img.shields.io/badge/Node-20%2B-green)
![pnpm](https://img.shields.io/badge/pnpm-monorepo-orange)
![Claude Code](https://img.shields.io/badge/Claude_Code-subprocess-purple)

---

## What Justice Does

### 1. iOS Build Automation

Isaiah texts a command like `hlstc batch m3-sessions` and Justice autonomously:
- Resolves all open beads for that phase (topological sort by dependencies)
- Creates a git worktree for branch isolation
- Runs each bead through a Claude Code subprocess
- Commits changes per-bead, pushes to origin
- Runs a final build check (xcodebuild) on the worktree
- Auto-fixes build errors (1 cycle)
- Runs a code review agent on the full diff
- Auto-remediates review concerns (up to 2 fix cycles)
- Sends one iMessage summary with approval stamp
- On approval: creates a draft PR, closes all beads

### 2. Executive Assistant

Responds to iMessage from approved numbers (Isaiah, Scott):
- Calendar management (Google Calendar)
- Email drafting and sending (Gmail)
- Task creation and tracking (beads)
- Notion workspace search, read, create, update
- Status briefings, morning briefs, proactive nudges

### 3. Wolf Law Employment Triage

Voice agent for law firm callers (branded as the subscribing firm):
- Intake via Twilio + ElevenLabs voice
- Statute matching and case scoring
- Case package generation
- Attorney routing across the network
- Multi-tenant: each law firm is an isolated tenant

---

## Architecture

```
justice-platform/
├── apps/
│   ├── justice-agent/              # Core agent — port 3002
│   │   └── src/
│   │       ├── modes/
│   │       │   ├── conversational-engine.ts   # 42 tools, Claude tool_use loop
│   │       │   ├── batch-runner.ts            # Autonomous batch execution
│   │       │   ├── code-executor.ts           # Claude Code subprocess mgmt
│   │       │   ├── review-agent.ts            # Code review + auto-remediation
│   │       │   ├── overnight-runner.ts        # Build checks, overnight runs
│   │       │   ├── executive.ts               # iMessage session management
│   │       │   └── executive-webhook.ts       # Twilio webhook server
│   │       ├── integrations/
│   │       │   ├── notion-logger.ts           # Notion structured logging
│   │       │   ├── approval-gate.ts           # Stamped approval system
│   │       │   ├── shell-exec.ts              # Whitelisted shell execution
│   │       │   ├── github.ts                  # Git worktrees, PRs, branches
│   │       │   └── migration-coordinator.ts   # Atomic migration numbers
│   │       └── registry/
│   │           ├── ios-projects.ts            # iOSProject type + registry API
│   │           └── project-registry.ts        # Env-driven project loader
│   ├── attorney-portal/            # Attorney subscription portal — port 3000
│   └── demo-portal/               # Wolf Law demo portal — port 3001
├── packages/
│   ├── shared-types/               # BatchState, iOSProject, TaskSession
│   ├── messaging/                  # iMessage + SMS sending
│   ├── scoring-engine/             # Case scoring algorithms
│   ├── knowledge-base/             # Statute text + case law
│   └── case-packages/             # Case package generation
├── skills/                         # SKILL.md files for Claude Code context
├── scripts/                        # Setup + utilities
└── CLAUDE.md                       # Agent architecture and rules
```

---

## Tools (42)

The conversational engine exposes 42 tools via Claude `tool_use`:

### iOS Build Automation (14)

| Tool | Description |
|------|-------------|
| `ios_build` | Build project with xcodebuild |
| `ios_clean` | Clear DerivedData, clean build |
| `ios_status` | Active batch progress or open beads + recent commits |
| `ios_pr` | Push branch, create draft PR (requires approval) |
| `ios_review` | Spawn review agent on current branch diff |
| `ios_run_overnight` | Autonomous overnight run through all unblocked beads |
| `ios_start_bead` | Claim and execute a specific bead |
| `ios_start_batch` | Run multiple beads on one branch, one review, one PR |
| `ios_queue` | Show all active batch statuses |
| `ios_resume_batch` | Resume a paused or failed batch |
| `ios_push_branch` | Push batch branch and create draft PR |
| `checkout_status` | List all active Redis task checkouts |
| `unstick_task` | Kill stuck task, release checkout, reopen bead |
| `justice_register` | Register a new project from Doppler env vars |

### Operations & System (4)

| Tool | Description |
|------|-------------|
| `justice_status` | Active tasks, pending approvals, last events |
| `status_check` | Current beads status (`bd ready`) |
| `code_execute` | Queue autonomous code execution (phased, Notion-logged) |
| `shell_exec` | Whitelisted shell commands (git, bd, gh, file ops) |

### Task & Case Management (6)

| Tool | Description |
|------|-------------|
| `create_task` | Create task in tracker |
| `list_tasks` | List tasks by assignee/status |
| `complete_task` | Mark task completed |
| `query_case_metrics` | Aggregate case counts, status breakdown |
| `query_case` | Look up case by session ID |
| `get_status_briefing` | Full status: cases, tasks, deadlines |

### Communication (4)

| Tool | Description |
|------|-------------|
| `draft_email` | Draft email for review (never auto-sends) |
| `confirm_send_email` | Send after explicit confirmation |
| `schedule_meeting` | Create Google Calendar event |
| `check_calendar` | Check calendar for date range |

### Notion (5)

| Tool | Description |
|------|-------------|
| `search_notion` | Search workspace pages |
| `read_notion_page` | Read full page content |
| `create_notion_page` | Create page under parent |
| `append_to_notion_page` | Append content to existing page |
| `query_notion_database` | Query database with filters |

### Outreach, Resume & Memory (5)

| Tool | Description |
|------|-------------|
| `linkedin_draft_batch` | Draft personalized outreach (logged to Notion, never sent) |
| `resume_generate` | Tailored resume YAML for a specific job |
| `resume_batch` | Batch resume generation for multiple roles |
| `email_resume` | Generate resume PDF and email it |
| `memory_log` | Log fact to long-term memory |

### Automation (4)

| Tool | Description |
|------|-------------|
| `configure_nudges` | Pause, resume, snooze task reminders |
| `morning_brief` | Control daily briefing (send now, enable/disable) |
| `ios_task` | List projects or get project details |
| `ios_run_overnight` | Autonomous overnight bead execution |

---

## Key Design Decisions

- **Claude Code subprocess auth**: Uses local subscription auth. `ANTHROPIC_API_KEY` is stripped from subprocess env to prevent double-billing.
- **Git worktrees**: Each batch runs in an isolated worktree. Main clone is never checked out to the batch branch.
- **Redis atomics**: Task checkout (`atomicClaim`), migration numbers (`claimNextMigrationNumber`), approval stamps, batch state — all Redis-backed.
- **Doppler-driven config**: All project config (paths, repos, phases, Notion IDs) lives in Doppler env vars. Zero hardcoded project data in source.
- **Single build check**: Build runs once after all beads complete (not per-bead). Runs in the worktree where the branch is checked out.
- **Approval stamps**: Never expire. `waitForApproval` loops with 6-hour re-pings until Isaiah responds.
- **Auto-remediation**: Review agent creates fix beads automatically. Up to 2 fix cycles before escalating to Isaiah.

---

## iMessage Command Reference

| Command | Tool | Description |
|---------|------|-------------|
| `hlstc batch m3-sessions` | `ios_start_batch` | Start batch for a phase |
| `hlstc status` | `ios_status` | Project + active batch status |
| `hlstc queue` | `ios_queue` | All active batches |
| `hlstc build` | `ios_build` | Manual build check |
| `push hlstc [branch]` | `ios_push_branch` | Push branch and create PR |
| `resume batch [id]` | `ios_resume_batch` | Resume a crashed batch |
| `justice register [project]` | `justice_register` | Register new project |
| `justice status` | `justice_status` | Overall agent status |
| `unstick [bead-id]` | `unstick_task` | Release stuck bead checkout |
| `checkout status` | `checkout_status` | All active Redis checkouts |
| `yes [stamp]` / `no [stamp]` | approval gate | Approve or decline pending action |

---

## New Project Onboarding

1. **Set Doppler secrets** for the new project:
   ```bash
   doppler secrets set \
     JUSTICE_REGISTERED_PROJECTS=hlstc,flaggd,newproject \
     NEWPROJECT_DISPLAY_NAME="My Project" \
     NEWPROJECT_REPO_ORG=theaionlab \
     NEWPROJECT_REPO_NAME=my-project \
     NEWPROJECT_LOCAL_PATH=/Users/justicewolf/Developer/ios/my-project \
     NEWPROJECT_XCODE_SCHEME=MyProject \
     NEWPROJECT_STACK=SwiftUI
   ```
2. **Restart the agent** so it picks up new env vars
3. **Text Justice**: `justice register newproject`
4. **Start batching**: `newproject batch phase-1`

---

## Prerequisites

- Mac with Apple Silicon (M1+)
- Xcode installed from the App Store
- Doppler account with access to the `justice` project
- GitHub access to `theaionlab` org and `ipeek-cpu/justice-platform`

## Installation

```bash
# Clone and run setup
gh repo clone ipeek-cpu/justice-platform ~/Developer/justice-repo
cd ~/Developer/justice-repo
bash scripts/justice-setup.sh

# Or with options
bash scripts/justice-setup.sh --dry-run              # Preview actions
bash scripts/justice-setup.sh --user anothermac       # Different username
```

The setup script is idempotent — safe to run multiple times.

## Running Justice

```bash
# Terminal 1 — Agent (port 3002)
cd apps/justice-agent && doppler run -- pnpm dev

# Terminal 2 — Demo portal (port 3001)
pnpm dev:demo-portal

# Terminal 3 — Cloudflare tunnel (routes api.wronged.ai → localhost:3002)
cloudflared tunnel run wronged-pilot
```

## Environment Variables

All secrets are managed in **Doppler** (project: `justice`, config: `production`).

See `.env.example` for the full list of required variables. Key groups:

| Group | Examples |
|-------|---------|
| API Keys | `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `CASETEXT_API_KEY` |
| Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` |
| Access Control | `APPROVED_NUMBER_ISAIAH`, `APPROVED_NUMBER_SCOTT` |
| Database | `DATABASE_URL`, `REDIS_URL` |
| Project Registry | `JUSTICE_REGISTERED_PROJECTS`, `HLSTC_*`, `FLAGGD_*` |
| Google | `GOOGLE_CALENDAR_CLIENT_ID`, `GMAIL_USER` |
| Notion | `JUSTICE_PARENT_PAGE_ID`, `NOTION_API_KEY` |

---

## Skills System

Claude Code reads `SKILL.md` files for context before executing autonomous tasks. 13 skills:

| Skill | Purpose |
|-------|---------|
| `autonomous-batch` | Batch execution golden workflow — the most critical skill |
| `ios-agent` | iOS build commands and PR patterns |
| `ios-development` | Swift/SwiftUI coding patterns |
| `code-execution` | Claude Code subprocess management |
| `atomic-checkout` | Redis-backed task locking |
| `beads-workflow` | Bead lifecycle and bd CLI usage |
| `notion-logger` | Structured Notion logging |
| `pattern-library` | Learned patterns from past executions |
| `shell-exec` | Whitelisted shell command execution |
| `linkedin-outreach` | LinkedIn message drafting |
| `resume-engine` | Resume tailoring and generation |
| `observability` | Execution logging and monitoring |

---

## License

Proprietary. All rights reserved by Wronged.ai.
