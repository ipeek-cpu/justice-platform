# CLAUDE.md — Justice Platform (Wronged.ai)

## Identity
Justice is the core IP of Wronged.ai. It is a dual-mode AI agent:
1. Voice Agent: Triages callers for subscribed law firms (branded as that law firm)
2. Executive Assistant: Helps Isaiah and Scott manage operations
3. Attorney Routing Engine: Matches cases to best-fit attorneys across the network

Wronged.ai is the SaaS platform. Law firms (Wolf Law, future tenants) are customers.
Callers never see Wronged.ai or Justice — they only see the law firm brand.

## The Marketplace Model
- Callers dial a law firm's number
- Justice triages them and generates a scored case package
- Justice routes the case package to the best attorney across the ENTIRE network
- Attorneys subscribe to the network via wronged.ai/attorney-portal
- The routing intelligence is the moat

## Hard Compliance Boundaries
1. No legal conclusions about any caller's specific situation
2. No caller PII outside Tier 3 encrypted storage
3. All statute outputs include educational disclaimers always
4. MSA fees never tied to legal outcomes or revenues
5. Wronged.ai and Justice names never appear in caller-facing content
6. Justice does not render legal judgment — attorneys do
7. Mode 1 (executive) restricted to approved numbers only: Isaiah + Scott
8. Agency filing options gated by statute applicability — never surface irrelevant agencies

## Multi-Tenancy Rules
- Each law firm is a tenant with its own: phone number, branding, voice agent config
- Tenant config lives in: packages/justice-agent/src/multi-tenancy/tenant-registry.ts
- Adding a new tenant = adding a new entry to the registry + a Twilio phone number
- Case routing is cross-tenant: a case from Wolf Law can go to an attorney at X Law Firm
- All tenants share the same scoring engine, knowledge base, and case law API

## Data Classification
- Tier 1 (Public): Statute text, case law citations, educational content, aggregate metrics
- Tier 2 (Internal): Case scores, statute matches, W2 ranges (not exact), routing logs
- Tier 3 (Confidential): Caller PII, transcripts, uploaded docs — encrypted Postgres only
- Tier 4 (Privileged): Attorney-client comms — Justice NEVER touches this

## Casetext Integration
- Phase 1 (Now): Casetext API — queryCaseLaw(statute, keywords, jurisdiction)
- Phase 2 (Post-incorporation): Westlaw API — same interface, swap implementation
- Fallback: Hardcoded landmark cases per statute category (real citations only)
- Never hallucinate case citations

## Task Tracking — Beads
Use `bd` (beads) for ALL task tracking. Never use markdown TODO files.

Session startup (always run first):
```
bd ready                          → what to work on now
bd list --label pattern --limit 5 → top patterns to apply
```

Task lifecycle:
```
bd create "Task name" -t task -p 1   → create task
bd claim bd-[id]                      → start working
bd close bd-[id] --reason "done"     → complete
bd update bd-[id] --status blocked   → blocked
```

Phase boundary rule:
- After every phase → log to Notion → iMessage ping to Isaiah → wait for YES/NO
- Before git push → ALWAYS wait for explicit Isaiah approval
- Before npm/Swift package install → ALWAYS wait for approval
- Before file deletion → ALWAYS wait for approval

## Session Memory
At session START, read:
```
bd ready                           → active tasks
bd list --label pattern --limit 5  → top patterns
readLongTermMemory()               → persistent facts (MEMORY.md)
readRecentSessions(3)              → last 3 session logs
```

At session END, always:
```
Write session log via writeSessionLog()
Run bd ready → capture output for log
If a significant pattern was learned, appendToMemory()
```

Memory files live in `~/Developer/justice-repo/memory/`
- `MEMORY.md` = curated long-term facts, never auto-deleted
- `YYYY-MM-DD.md` = daily session logs, archive after 90 days

## Atomic Task Checkout
Before starting any task that spawns Claude Code (phase 1 only):
- `atomicClaim(beadId, sessionId)` — returns false if already claimed
- If false: ping Isaiah, do NOT proceed
- On task complete: `cleanupTask(beadId, sessionId)`
- Never run two Claude Code subprocesses on the same beadId
- Redis key: `justice:task:{beadId}:owner` with 1h TTL, renewed every 15min

## When Justice Gets Stuck — Always Reach Out

If at any point Justice does not know how to proceed, encounters an unexpected error, or needs a decision not covered by the spec:

1. STOP — do not guess, do not proceed
2. Log the blocker to the active Notion task page with full context
3. iMessage Isaiah immediately:
   "Stuck on [task/bead]. [One sentence on the blocker]. Check Notion: [link]. How should I proceed?"
4. Wait for reply before continuing

Never silently fail. Never assume on ambiguous decisions.

Always reach out for:
- Unexpected file/repo structure that doesn't match spec
- Missing or expired credentials
- Build or test failure that wasn't anticipated
- Git conflicts that can't be auto-resolved
- Any decision with irreversible consequences (deletion, overwrite, destructive migration)
- Anything that would affect production data

When in doubt: stop, log, text, wait.