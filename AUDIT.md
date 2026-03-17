# Justice Platform — Full Codebase Audit

**Date:** 2026-03-13
**Scope:** All .ts files in ~/Developer/justice-repo (excluding node_modules, .next)
**Total files audited:** 48 .ts files + config/scripts/infra

---

## FILE-BY-FILE REPORT

### apps/justice-agent/src/ (19 .ts files)

| # | File | Purpose | Status | Issues |
|---|------|---------|--------|--------|
| 1 | `src/index.ts` | Entry point — starts webhook, wires DB shutdown | WORKING | None |
| 2 | `src/db/connection.ts` | Drizzle + postgres singleton | WORKING | None |
| 3 | `src/db/schema.ts` | 4 tables: cases, triage_sessions, tasks, audit_log | WORKING | Missing indexes; caller_phone unencrypted (Tier 3 violation) |
| 4 | `src/db/queries.ts` | CRUD for cases, tasks, audit_log | WORKING | None |
| 5 | `src/modes/executive-webhook.ts` | HTTP server, Twilio+iMessage routing | WORKING | Signature validation skipped if no TWILIO_AUTH_TOKEN |
| 6 | `src/modes/executive.ts` | Executive assistant loop (Mode 1) | WORKING | Sessions in-memory (lost on restart) |
| 7 | `src/modes/intent-parser.ts` | Claude API intent classifier | WORKING | None |
| 8 | `src/modes/action-executor.ts` | Executes intents, DB-backed | WORKING | Calendar/email stubs remain; pendingActions in-memory |
| 9 | `src/modes/routing.ts` | Mode 3 attorney routing | STUB | **ORPHAN** — never imported |
| 10 | `src/modes/voice-agent.ts` | Mode 2 system prompt builder | STUB | **ORPHAN** — never imported |
| 11 | `src/access-control/approved-numbers.ts` | Isaiah+Scott gate | WORKING | None |
| 12 | `src/multi-tenancy/tenant-registry.ts` | Wolf Law tenant config | WORKING | None |
| 13 | `src/multi-tenancy/tenant-router.ts` | Routes inbound by phone number | WORKING | **ORPHAN** — never imported |
| 14 | `src/integrations/twilio.ts` | Signature validation + TwiML helpers | WORKING | **ORPHAN** — duplicated in executive-webhook.ts |
| 15 | `src/integrations/elevenlabs.ts` | ElevenLabs agent config | STUB | **ORPHAN** — never imported |
| 16 | `src/integrations/claude-api.ts` | Claude API wrapper | WORKING | **ORPHAN** — calls inlined in intent-parser.ts instead |
| 17 | `src/integrations/casetext.ts` | Re-exports queryCaseLaw | STUB | **ORPHAN** — passthrough, never imported |
| 18 | `src/integrations/calendar-email.ts` | Google Calendar + Gmail stubs | STUB | **ORPHAN** — never imported |
| 19 | `drizzle.config.ts` | Drizzle migration config | WORKING | None |

### packages/shared-types/src/ (5 files)

| # | File | Purpose | Imports | Exports | Status |
|---|------|---------|---------|---------|--------|
| 1 | `index.ts` | Barrel export | triage, case-package, attorney, tenant | All types | WORKING |
| 2 | `triage.ts` | TriageContext, ScoredStatute types | None | StatuteCategory, EmployerType, Geography, WorkerType, TriageContext, ScoredStatute, AgencyOption, ApplicabilityCondition, EconomicViabilityScore | WORKING |
| 3 | `case-package.ts` | CasePackage output types | ScoredStatute, EconomicViabilityScore from triage | CaseLawResult, ArguingPoint, RiskFlag, CasePackage, AgencyOptionSummary, RecommendedAction, TransparencyEntry | WORKING |
| 4 | `attorney.ts` | Attorney and routing types | None | Attorney, RoutingResult, RoutingEvent | WORKING |
| 5 | `tenant.ts` | LawFirmTenant type | None | LawFirmTenant | WORKING |

### packages/knowledge-base/src/ (8 files)

| # | File | Purpose | Status |
|---|------|---------|--------|
| 1 | `index.ts` | Barrel export | WORKING |
| 2 | `statutes/types.ts` | Statute interface | WORKING |
| 3 | `statutes/index.ts` | Barrel for statutes | WORKING |
| 4 | `statutes/illinois-statutes.ts` | 27 IL + federal statutes | WORKING |
| 5 | `case-law/index.ts` | Barrel for case law | WORKING |
| 6 | `case-law/casetext-integration.ts` | Casetext API + 7 fallback landmark cases | WORKING (API stub, fallback works) |
| 7 | `agency-filings/index.ts` | Barrel for agencies | WORKING |
| 8 | `agency-filings/agencies.ts` | 5 agencies (IDOL, IDHR, OSHA, NLRB, EEOC) | WORKING |

### packages/scoring-engine/src/ (6 files)

| # | File | Purpose | Status |
|---|------|---------|--------|
| 1 | `index.ts` | Barrel export | WORKING |
| 2 | `statute-matcher.ts` | Match + score statutes against context | WORKING |
| 3 | `economic-viability.ts` | Contingency viability scoring | WORKING |
| 4 | `arguing-points.ts` | Generate arguing points for attorneys | WORKING |
| 5 | `risk-assessment.ts` | SOL, documentation, employer risk flags | WORKING |
| 6 | `agency-options.ts` | Filter applicable agencies by statute | WORKING |

### packages/case-packages/src/ (5 files)

| # | File | Purpose | Status | Issues |
|---|------|---------|--------|--------|
| 1 | `index.ts` | Barrel export | WORKING | None |
| 2 | `summary-generator.ts` | Plain English deal summary | WORKING | None |
| 3 | `package-formatter.ts` | Format for SMS/JSON/portal link | WORKING | No PORTAL_BASE_URL fallback |
| 4 | `deck-generator.ts` | Assemble full case deck | WORKING | None |
| 5 | `transparency-log.ts` | Score breakdown per statute | WORKING | None |

### packages/messaging/src/ (5 files)

| # | File | Purpose | Status | Issues |
|---|------|---------|--------|--------|
| 1 | `index.ts` | Barrel export | WORKING | None |
| 2 | `imessage-sender.ts` | AppleScript iMessage send | WORKING | macOS-only |
| 3 | `sms-sender.ts` | Twilio SMS send | WORKING | None |
| 4 | `message-templates.ts` | Law-firm-branded templates (no Wronged.ai branding) | WORKING | None |
| 5 | `followup-scheduler.ts` | Delayed follow-up queue | WORKING | In-memory (lost on restart) |

---

## DEPENDENCY GRAPH

```
index.ts
 └── executive-webhook.ts
      ├── access-control/approved-numbers.ts
      └── modes/executive.ts
           ├── access-control/approved-numbers.ts
           ├── modes/intent-parser.ts ──────────────── → Claude API
           ├── modes/action-executor.ts
           │    └── db/queries.ts
           │         ├── db/connection.ts
           │         │    └── db/schema.ts
           │         └── db/schema.ts
           └── db/queries.ts

@justice/justice-agent
 ├── @justice/shared-types (no deps)
 ├── @justice/knowledge-base → @justice/shared-types
 ├── @justice/scoring-engine → @justice/shared-types, @justice/knowledge-base
 ├── @justice/case-packages → @justice/shared-types, @justice/knowledge-base, @justice/scoring-engine
 └── @justice/messaging → @justice/shared-types

ORPHANED (never imported by any file):
 ├── modes/routing.ts
 ├── modes/voice-agent.ts
 ├── multi-tenancy/tenant-router.ts
 ├── integrations/twilio.ts
 ├── integrations/elevenlabs.ts
 ├── integrations/claude-api.ts
 ├── integrations/casetext.ts
 └── integrations/calendar-email.ts
```

---

## DB INTEGRATION VERIFICATION

**action-executor.ts line 16:**
```typescript
import { getCaseBySessionId, getCaseMetrics, createTask, getTasksByAssignee, logAuditEntry } from '../db/queries';
```
Confirmed: `handleCaseQuery`, `handleTaskCreate`, `handleTaskList`, `handleStatusUpdate` all call real DB functions. Old TODO stubs replaced.

**executive.ts line 22:**
```typescript
import { logAuditEntry } from '../db/queries';
```
Confirmed: `logAudit()` writes to Postgres instead of in-memory array.

**index.ts line 10:**
```typescript
import { closeDatabaseConnection } from './db/connection';
```
Confirmed: Wired into SIGTERM/SIGINT.

**Migration SQL matches schema.ts:** 4 tables, all columns aligned. No drift.

---

## ALL TODO/FIXME COMMENTS

| File | Line | Comment |
|------|------|---------|
| `modes/action-executor.ts` | ~194 | `// TODO: Integrate with Google Calendar API` |
| `modes/action-executor.ts` | ~492 | `// TODO: Create Google Calendar event` |
| `modes/action-executor.ts` | ~498 | `// TODO: Send via Gmail API` |
| `modes/routing.ts` | 78 | `// TODO: Query from database` (orphan file) |
| `integrations/calendar-email.ts` | 5 | `// TODO: Implement OAuth2 flow` (orphan file) |
| `integrations/calendar-email.ts` | 26 | `// TODO: Integrate with Google Calendar API` (orphan file) |
| `integrations/calendar-email.ts` | 33 | `// TODO: Integrate with Google Calendar API` (orphan file) |
| `integrations/calendar-email.ts` | 39 | `// TODO: Integrate with Gmail API` (orphan file) |

---

## HARDCODED VALUES THAT SHOULD BE ENV VARS

| File | Value | Risk |
|------|-------|------|
| `intent-parser.ts:128` | `claude-sonnet-4-20250514` | Medium — model pinned |
| `action-executor.ts:419` | `claude-sonnet-4-20250514` | Medium — model pinned |
| `tenant-registry.ts:16` | `https://wolflaw.ai/documents` | Low — tenant config |
| `casetext-integration.ts:3` | `https://api.casetext.com/v1` | Low — stable 3rd party |
| `elevenlabs.ts:6` | `https://api.elevenlabs.io/v1` | Low — stable 3rd party |
| `agencies.ts:6,20,35,48,61` | Agency website URLs (labor.illinois.gov, etc.) | Low — public, stable |

---

## ALL REFERENCED PATHS, URLS, ENDPOINTS

| File | URL/Path |
|------|----------|
| `executive-webhook.ts` | `POST /webhook/executive`, `POST /api/executive/inbound`, `GET /health` |
| `executive-webhook.ts:123` | `https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json` |
| `intent-parser.ts:120` | `https://api.anthropic.com/v1/messages` |
| `action-executor.ts:411` | `https://api.anthropic.com/v1/messages` |
| `sms-sender.ts:18` | `https://api.twilio.com/2010-04-01/Accounts/...` |
| `casetext-integration.ts:3` | `https://api.casetext.com/v1` |
| `elevenlabs.ts:6` | `https://api.elevenlabs.io/v1` |
| `cloudflared config` | `api.wronged.ai → localhost:3002`, `justice.wronged.ai → localhost:3002` |
| `imessage-listener.sh` | `http://localhost:3002/webhook/executive` |
| Twilio console | SMS webhook: `https://justice.wronged.ai/api/executive/inbound` |
| Twilio console | Voice webhook: `https://justice.wronged.ai/api/voice/inbound` (no handler) |

---

## INBOUND iMESSAGE FLOW (exact file order)

```
1. User sends iMessage to justice@wolflaw.ai
   ↓
2. scripts/justice-imessage-listener.sh
   - Polls ~/Library/Messages/chat.db (SQLite)
   - Filters: is_from_me=0, rowid > last_processed
   - Normalizes sender phone
   - POSTs JSON to http://localhost:3002/webhook/executive
   ↓
3. apps/justice-agent/src/modes/executive-webhook.ts
   - parseJsonBody() → { from, body, channel: 'imessage' }
   ↓
4. apps/justice-agent/src/access-control/approved-numbers.ts
   - isApprovedNumber(from) → true/false
   ↓
5. apps/justice-agent/src/modes/executive.ts
   - handleExecutiveMessage(phone, text)
   - getOrCreateSession() [in-memory Map, 2hr expiry]
   ↓
6. apps/justice-agent/src/modes/intent-parser.ts
   - parseIntent() → POST https://api.anthropic.com/v1/messages
   - Claude returns JSON { type, params }
   ↓
7. apps/justice-agent/src/modes/action-executor.ts
   - executeIntent(intent) → routes to handler
   ↓
8. apps/justice-agent/src/db/queries.ts
   - createTask() / getCaseMetrics() / logAuditEntry()
   ↓
9. apps/justice-agent/src/db/connection.ts → schema.ts → Postgres
   ↓
10. Response bubbles back: executive.ts → executive-webhook.ts
    - sendJson(200, { reply: "..." })
    ↓
11. scripts/justice-imessage-listener.sh
    - Parses reply from JSON
    - AppleScript: tell application "Messages" send reply to sender
```

---

## INBOUND TWILIO SMS FLOW (exact file order)

```
1. User texts +1 (630) 716-9319
   ↓
2. Twilio POST → https://justice.wronged.ai/api/executive/inbound
   Content-Type: application/x-www-form-urlencoded
   X-Twilio-Signature: <HMAC-SHA1>
   Body: From, Body, MessageSid, etc.
   ↓
3. Cloudflared tunnel → localhost:3002/api/executive/inbound
   ↓
4. apps/justice-agent/src/modes/executive-webhook.ts
   - readBody() → raw form string
   - validateTwilioSignature() using TWILIO_AUTH_TOKEN + WEBHOOK_BASE_URL
   - parseTwilioForm() → { from, body, channel: 'sms' }
   ↓
5. approved-numbers.ts → isApprovedNumber()
   ↓
6-9. Same as iMessage flow (executive.ts → intent-parser → action-executor → DB)
   ↓
10. executive-webhook.ts
    - sendTwilioReply(to, reply) → POST to Twilio Messages API
    - sendTwiml(res) → empty <Response></Response>
```

**Known issue:** Twilio outbound SMS returns error 30034 (A2P 10DLC registration required). Reply is queued but carrier-blocked.

---

## INBOUND TWILIO VOICE CALL FLOW

**NOT IMPLEMENTED.**

Twilio console has voice webhook set to `https://justice.wronged.ai/api/voice/inbound` but no handler exists at that path. The server returns 404.

Orphaned files that would form this flow:
- `tenant-router.ts` — routing decision (Mode 1 vs Mode 2)
- `voice-agent.ts` — system prompt builder per tenant
- `elevenlabs.ts` — ElevenLabs API integration

None are wired into the HTTP server.

---

## ORPHANED FILES (8 total)

| File | Why orphaned |
|------|-------------|
| `modes/routing.ts` | Mode 3 never wired into any handler |
| `modes/voice-agent.ts` | Mode 2 never wired into any handler |
| `multi-tenancy/tenant-router.ts` | Router exists but webhook doesn't use it |
| `integrations/twilio.ts` | Duplicate — signature validation inlined in executive-webhook.ts |
| `integrations/elevenlabs.ts` | No voice call handler to use it |
| `integrations/claude-api.ts` | Never imported — Claude calls inlined in intent-parser.ts and action-executor.ts |
| `integrations/casetext.ts` | Passthrough re-export, never imported |
| `integrations/calendar-email.ts` | All stubs, never imported |

## BROKEN IMPORTS

**None found.** All imports resolve to existing files.

---

## CRITICAL FINDINGS

### Severity: HIGH

1. **Tier 3 PII violation** — `cases.caller_phone` stored unencrypted in Postgres. CLAUDE.md requires "Tier 3 (Confidential) — encrypted Postgres only" for caller PII.

2. **Voice call flow not implemented** — Twilio voice webhook (`/api/voice/inbound`) has no handler. Inbound calls get 404. 8 orphaned files contain the building blocks but are never connected.

3. **SMS reply blocked** — Twilio error 30034. Outbound SMS from +16307169319 is carrier-blocked. Requires A2P 10DLC registration in Twilio console.

### Severity: MEDIUM

4. **In-memory state lost on restart** — Executive sessions (`Map<string, ExecutiveSession>`) and pending actions (`Map<string, PendingAction>`) are in-memory. Server restart loses all conversation context and pending confirmations. `REDIS_URL` is defined in .env.example but never used.

5. **Missing DB indexes** — No indexes on `cases.tenant_id`, `cases.status`, `cases.created_at`, `audit_log.created_at`, `tasks.assignee`. Will degrade as tables grow.

6. **PORTAL_BASE_URL no fallback** — `package-formatter.ts` uses `process.env.PORTAL_BASE_URL` without fallback. If unset, SMS links will contain `undefined`.

7. **iMessage listener race condition** — No lock file; multiple cron/loop instances can process the same message twice. Rowid tracker stored in `/tmp/` (cleared on reboot).

### Severity: LOW

8. **Duplicate code** — Twilio signature validation implemented in both `executive-webhook.ts` and `integrations/twilio.ts`.

9. **Claude model hardcoded** — `claude-sonnet-4-20250514` appears in 2 files. Should be env var for easy updates.

10. **Calendar + email stubs** — `handleCheckCalendar()` and `executePendingAction()` for meetings/emails return placeholder text. Google Calendar and Gmail not integrated.

---

## COMPLIANCE CHECK VS CLAUDE.md

| Requirement | Status | Evidence |
|-------------|--------|----------|
| No legal conclusions | PASS | Scoring only; disclaimer in deck-generator |
| No caller PII outside Tier 3 encrypted storage | **FAIL** | caller_phone unencrypted in cases table |
| Statute outputs include disclaimers | PASS | Standard disclaimer in deck-generator.ts |
| MSA fees never tied to outcomes | N/A | No billing code exists |
| Wronged.ai/Justice not in caller-facing content | PASS | All templates use tenant.displayName |
| Justice does not render legal judgment | PASS | Attorneys decide; scoring is informational |
| Mode 1 restricted to Isaiah + Scott | PASS | approved-numbers.ts gate |
| Agency options gated by statute applicability | PASS | agency-options.ts filters by conditions |

---

## PORT MAP

| Port | Service | Status |
|------|---------|--------|
| 3000 | Attorney Portal (Next.js) | Not running (dev only) |
| 3001 | Demo Portal (Next.js) | Not running (dev only) |
| 3002 | Executive Webhook (justice-agent) | RUNNING |

## INFRASTRUCTURE

| Component | Status |
|-----------|--------|
| Cloudflared tunnel (`wronged-pilot`) | RUNNING — api.wronged.ai + justice.wronged.ai → localhost:3002 |
| PostgreSQL 16 | RUNNING — database `justice`, 4 tables |
| iMessage listener | RUNNING (background loop, 5s poll) |
| Doppler secrets | CONFIGURED — project `justice-platform`, config `dev` |
