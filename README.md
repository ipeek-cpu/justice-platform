# Justice — The Core IP of Wronged.ai

> Autonomous AI agent powering the **Wronged.ai** legal marketplace. Justice triages callers for subscribing law firms, routes scored case packages to the best-fit attorney across the network, assists executive operations, and drives end-to-end iOS build automation.

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![Node](https://img.shields.io/badge/Node-20%2B-green)
![pnpm](https://img.shields.io/badge/pnpm-monorepo-orange)
![Claude Code](https://img.shields.io/badge/Claude_Code-subprocess-purple)

---

## Platform Context: Wronged.ai

**Wronged.ai** is the SaaS platform. Subscribing law firms (Wolf Law today, future tenants tomorrow) are customers. **Justice** is the agent. Callers never see Wronged.ai or Justice — they experience only the subscribing law firm's brand.

The moat is the routing intelligence: a caller dials a tenant law firm's number, Justice triages, scores, and packages the case, then routes it to the best-fit attorney across the **entire network** — regardless of which tenant took the call.

```
    Caller                   Tenant Firm                    Wronged.ai Network
  ┌────────┐   dials     ┌────────────────┐   routed    ┌──────────────────────┐
  │ Caller │ ──────────▶ │  Wolf Law #    │ ─────────▶  │  Best-fit attorney   │
  │        │             │  (branded IVR) │  case pkg   │  anywhere in network │
  └────────┘             └────────────────┘             └──────────────────────┘
                                  ▲                                  │
                                  │    Justice scoring + routing     │
                                  └──────────────────────────────────┘
```

---

## Justice's Three Roles

### 1. Voice Agent (Caller-Facing, Per-Tenant Branded)
Handles inbound calls to a subscribing law firm:
- Intake via **Twilio + ElevenLabs** conversational voice
- Statute matching against the knowledge base
- **Six-element case scoring** (WS7 case package engine)
- Case package generation with educational disclaimers
- Cross-network attorney routing via the marketplace engine
- Zero mention of Wronged.ai or Justice in caller-facing content

### 2. Executive Assistant (Isaiah + Scott Only)
Responds to iMessage from approved numbers only:
- Calendar management (Google Calendar)
- Email drafting and sending (Gmail, never auto-sends)
- Task creation and tracking (beads)
- Notion workspace search, read, create, update
- Status briefings, morning briefs, proactive nudges
- Resume tailoring + LinkedIn outreach drafting

### 3. iOS Build Automation
Isaiah texts `hlstc batch m3-sessions` and Justice autonomously:
- Resolves all open beads for that phase (topological sort by dependencies)
- Creates an isolated git worktree for the branch
- Runs each bead through a Claude Code subprocess
- Commits per-bead, pushes to origin
- Runs a final `xcodebuild` check on the worktree
- Auto-fixes build errors (1 cycle)
- Runs a review agent on the full diff, auto-remediates (up to 2 fix cycles)
- Sends **one** iMessage summary with approval stamp
- On `yes`: creates a draft PR, closes all beads

---

## Multi-Tenancy Model

Each law firm is an isolated tenant with its own phone number, branding, and voice-agent configuration. Tenant registry lives at:

```
packages/justice-agent/src/multi-tenancy/tenant-registry.ts
```

Onboarding a new tenant = one registry entry + one Twilio phone number. All tenants share the same scoring engine, knowledge base, and case-law API. **Case routing is cross-tenant** — the marketplace routes to the best attorney regardless of which firm took the call.

---

## Hard Compliance Boundaries

1. No legal conclusions about any caller's specific situation
2. No caller PII outside Tier 3 encrypted storage
3. All statute outputs include educational disclaimers — always
4. MSA fees never tied to legal outcomes or revenues
5. Wronged.ai and Justice names never appear in caller-facing content
6. Justice does not render legal judgment — attorneys do
7. Executive mode (Mode 2) restricted to approved numbers only
8. Agency filing options gated by statute applicability — never surface irrelevant agencies

## Data Classification

| Tier | Classification | Examples | Storage |
|------|---------------|----------|---------|
| 1 | Public | Statute text, case-law citations, educational content, aggregate metrics | Anywhere |
| 2 | Internal | Case scores, statute matches, W2 ranges (never exact), routing logs | Internal DB |
| 3 | Confidential | Caller PII, transcripts, uploaded docs | **Encrypted Postgres only** |
| 4 | Privileged | Attorney-client communications | **Justice never touches this** |

## Case-Law Integration

- **Phase 1 (now)**: Casetext API — `queryCaseLaw(statute, keywords, jurisdiction)`
- **Phase 2 (post-incorporation)**: Westlaw API — same interface, swapped implementation
- **Fallback**: Hardcoded landmark cases per statute category (real citations only)
- Justice **never** hallucinates case citations

---

## Architecture

```
justice-repo/
├── apps/
│   ├── justice-agent/              # Core agent — port 3002
│   │   └── src/
│   │       ├── modes/
│   │       │   ├── conversational-engine.ts   # Claude tool_use loop (42 tools)
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
│   │       │   ├── migration-coordinator.ts   # Atomic migration numbers
│   │       │   └── google-workspace.ts        # Calendar + Gmail
│   │       ├── multi-tenancy/                 # Tenant registry + brand config
│   │       ├── access-control/                # Approved-number gate
│   │       ├── cron/                          # proactive-agent, schedule
│   │       ├── nudge/                         # Proactive reminders
│   │       └── registry/
│   │           ├── ios-projects.ts            # iOSProject type + registry API
│   │           └── project-registry.ts        # Env-driven project loader
│   ├── attorney-portal/            # Attorney subscription portal — port 3000
│   └── demo-portal/                # Wolf Law demo dashboard — port 3001
├── packages/
│   ├── shared-types/               # BatchState, iOSProject, TaskSession
│   ├── messaging/                  # iMessage + SMS sending
│   ├── scoring-engine/             # Six-element case scoring (WS7)
│   ├── knowledge-base/             # Statute text + case law
│   └── case-packages/              # Case package generation
├── skills/                         # SKILL.md context files for Claude Code
├── scripts/                        # justice-setup.sh, iMessage listener
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

## Approval Gate + Beads Lifecycle

### Approval Stamps
Every action with irreversible consequences requires an explicit human `yes` from Isaiah. Stamps:
- Never expire — `waitForApproval` loops with 6-hour re-pings
- Support multi-stamp parsing: `yes A1B yes C2D no E3F` resolves all three
- Bare `yes`/`no` targets the most recent pending approval

**Required approvals:**
- `git push`
- `npm`/Swift package install
- File deletion
- Phase boundary (log to Notion → iMessage → wait for YES/NO)

### Beads (`bd`) for All Task Tracking
Never markdown TODO files. Lifecycle:
```
open → in_progress (bd claim) → in_review (commits verified) → closed (PR created + approved)
```
A bead never closes without verified commits **and** a PR (or an explicit waiver).

### Atomic Task Checkout
Before spawning a Claude Code subprocess:
```
atomicClaim(beadId, sessionId)  # Redis key with 1h TTL, renewed every 15min
```
Returns false if the bead is already claimed — Justice pings Isaiah and stops. Never two subprocesses on the same bead.

---

## Session Memory

Local, never committed:

| File | Purpose |
|------|---------|
| `memory/MEMORY.md` | Curated long-term facts, never auto-deleted |
| `memory/YYYY-MM-DD.md` | Daily session log (archive after 90 days) |
| `memory/execution-log.jsonl` | Append-only event log for every bead action |

**At session start**: `bd ready` → `bd list --label pattern` → `readLongTermMemory()` → last 3 session logs.
**At session end**: `writeSessionLog()`, `appendToMemory()` on significant patterns, `git push`.

See the Observability skill for detailed event-logging rules.

---

## Key Design Decisions

- **Claude Code subprocess auth**: Uses local subscription auth. `ANTHROPIC_API_KEY` is stripped from subprocess env to prevent double-billing.
- **Git worktrees**: Each batch runs in an isolated worktree. Main clone is never checked out to the batch branch.
- **Redis atomics**: Task checkout, migration numbers, approval stamps, batch state, build locks — all Redis-backed.
- **Doppler-driven config**: All project config (paths, repos, phases, Notion IDs) lives in Doppler. Zero hardcoded project data in source.
- **Single build check**: Build runs once after all beads complete, in the worktree where the branch is checked out.
- **Auto-remediation**: Review agent creates fix beads automatically. Up to 2 fix cycles before escalating to Isaiah.
- **Stuck detection**: 30-minute no-event threshold triggers proactive alert on the 8am cron.

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
gh repo clone ipeek-cpu/justice-platform ~/Developer/justice-repo
cd ~/Developer/justice-repo
bash scripts/justice-setup.sh

# Or with options
bash scripts/justice-setup.sh --dry-run              # Preview actions
bash scripts/justice-setup.sh --user anothermac      # Different username
```

The setup script is idempotent — safe to run multiple times.

## Running Justice

```bash
# Terminal 1 — Agent (port 3002)
cd apps/justice-agent && doppler run -- pnpm dev

# Terminal 2 — Demo portal (port 3001)
pnpm dev:demo-portal

# Terminal 3 — Attorney portal (port 3000)
pnpm dev:attorney-portal

# Terminal 4 — Cloudflare tunnel (routes api.wronged.ai → localhost:3002)
cloudflared tunnel run wronged-pilot
```

## Environment Variables

All secrets are managed in **Doppler** (project: `justice`, config: `production`).

See `.env.example` for the full list. Key groups:

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

Claude Code reads `SKILL.md` files for context before executing autonomous tasks:

| Skill | Purpose |
|-------|---------|
| `autonomous-batch` | Batch execution golden workflow — the most critical skill |
| `ios-agent` | iOS build commands and PR patterns |
| `ios-development` | Swift/SwiftUI coding patterns |
| `code-execution` | Claude Code subprocess management |
| `atomic-checkout` | Redis-backed task locking |
| `beads-workflow` | Bead lifecycle and `bd` CLI usage |
| `notion-logger` | Structured Notion logging |
| `pattern-library` | Learned patterns from past executions |
| `shell-exec` | Whitelisted shell command execution |
| `linkedin-outreach` | LinkedIn message drafting |
| `resume-engine` | Resume tailoring and generation |
| `observability` | Execution logging and monitoring |

---

## When Justice Gets Stuck

If Justice encounters an unexpected error, ambiguous decision, or situation not covered by spec, the rule is:

1. **STOP** — do not guess, do not proceed
2. Log the blocker to the active Notion task page with full context
3. iMessage Isaiah with a one-line summary + Notion link
4. Wait for reply

Always reach out for:
- Unexpected file/repo structure that doesn't match spec
- Missing or expired credentials
- Build or test failure that wasn't anticipated
- Git conflicts that can't be auto-resolved
- Any decision with irreversible consequences (deletion, overwrite, destructive migration)
- Anything affecting production data

When in doubt: **stop, log, text, wait.**

---

## License

Proprietary. All rights reserved by Wronged.ai.
