# Justice Platform Refactor — Conversational Engine + PII Encryption + Voice Handler

Read CLAUDE.md in the repo root before writing a single line of code. Every decision must trace back to CLAUDE.md.

## CONTEXT

This is the justice-repo monorepo on the Mac Mini. The agent runs on port 3002 via `doppler run -- pnpm dev:agent`. A full codebase audit was just completed. This refactor addresses three critical gaps:

1. **Executive mode is a rigid classifier → switch statement instead of a conversational AI.** Users text Justice and get phone-tree responses. It should feel like texting a smart chief of staff.
2. **Tier 3 PII violation.** `cases.caller_phone` is stored unencrypted. CLAUDE.md requires encryption for all caller PII.
3. **Voice call handler doesn't exist.** Twilio voice webhook points to `/api/voice/inbound` but the server returns 404.

## WHAT TO KEEP (DO NOT MODIFY)

- `apps/justice-agent/src/modes/executive-webhook.ts` — the HTTP server. Do not change routes, body parsers, Twilio signature validation, or response helpers. Only change: import the new conversational engine instead of the old executive.ts.
- `apps/justice-agent/src/access-control/approved-numbers.ts` — approved numbers gate. Do not touch.
- `apps/justice-agent/src/db/connection.ts` — drizzle singleton. Do not touch.
- `apps/justice-agent/src/db/schema.ts` — modify only to add encryption and indexes (see Part 2).
- `apps/justice-agent/src/db/queries.ts` — modify only to handle encrypted phone fields (see Part 2).
- `apps/justice-agent/src/multi-tenancy/tenant-registry.ts` — do not touch.
- ALL files in `packages/` — do not touch any package. They are working and compliant.
- `scripts/justice-imessage-listener.sh` — do not touch.
- `~/Library/LaunchAgents/ai.wolflaw.justice.imessage.plist` — do not touch.

## PART 1 — CONVERSATIONAL ENGINE (replace intent-parser.ts + action-executor.ts)

### Delete these files:
- `apps/justice-agent/src/modes/intent-parser.ts`
- `apps/justice-agent/src/modes/action-executor.ts`

### Create: `apps/justice-agent/src/modes/conversational-engine.ts`

This replaces both deleted files with a single Claude API call using `tool_use`.

**Architecture:**
- One function: `handleMessage(phoneNumber: string, messageText: string, callerIdentity: 'isaiah' | 'scott', conversationHistory: ConversationMessage[]): Promise<{ response: string; updatedHistory: ConversationMessage[] }>`
- Makes ONE Claude API call with:
  - `model`: read from env var `CLAUDE_MODEL` with fallback `claude-sonnet-4-20250514`
  - `system`: the executive system prompt (see below)
  - `messages`: full conversation history + new user message
  - `tools`: array of tool definitions (see below)
  - `max_tokens`: 1024
- If Claude returns `tool_use` blocks, execute the tool calls, then send the results back to Claude in a follow-up API call so Claude can formulate a natural response. Loop until Claude returns a final `text` response (max 5 tool-use rounds to prevent infinite loops).
- Return Claude's final text response and the updated conversation history (including all tool calls and results, so context is preserved).

**System prompt:**
```
You are Justice, the executive assistant for Wolf Law and Wronged.ai. You are texting with {callerIdentity} via iMessage.

You help with:
- Calendar: Schedule calls, meetings, block focus time
- Email: Draft and send professional outreach (always confirm before sending)
- Tasks: Create, list, and track deliverables
- Case analysis: Pull metrics, query specific cases, pipeline status
- Business operations: Filing status, MSA tracking, attorney subscriptions
- General questions: Answer anything about operations, strategy, or the platform

Personality:
- You are concise, warm, and proactive. Text like a sharp chief of staff, not a chatbot.
- Use short messages. No bullet points unless listing multiple items.
- Don't announce what you're doing ("Let me check that for you..."). Just do it and respond with the result.
- If something fails or isn't available yet, say so plainly and suggest an alternative.
- Match the energy of the conversation. If they text "yo" you can text back casually. If they ask for a formal email draft, be professional.

Rules:
- NEVER send any email without explicit confirmation. Draft it, show it, wait for "yes/send/go".
- NEVER schedule on another person's calendar without confirmation.
- NEVER share case data with unauthorized parties.
- NEVER make legal recommendations. Attorneys decide.
- Log all actions for audit trail.

Current date: {currentDate}
```

**Tool definitions (these are Claude tool_use tools, NOT function calls):**

1. `query_case_metrics` — no parameters. Returns total cases, cases by status, cases by category, cases today. Calls `getCaseMetrics()` from db/queries.ts.

2. `query_case` — params: `{ session_id: string }`. Returns full case details for a specific session. Calls `getCaseBySessionId()` from db/queries.ts.

3. `create_task` — params: `{ title: string, assignee?: string, priority?: "high" | "medium" | "low", deadline?: string }`. Creates a task in Postgres. Calls `createTask()` from db/queries.ts. Returns the created task with its ID.

4. `list_tasks` — params: `{ assignee?: string, status_filter?: "all" | "pending" | "completed" | "overdue" }`. Lists tasks from Postgres. Calls `getTasksByAssignee()` from db/queries.ts.

5. `complete_task` — params: `{ task_id: string }`. Marks a task as completed. Add this function to db/queries.ts.

6. `draft_email` — params: `{ to: string[], subject: string, body: string }`. Returns the draft for confirmation. Does NOT send. Sets a pending action flag.

7. `confirm_send_email` — params: `{ confirmed: boolean }`. If confirmed=true, sends via Gmail (stub for now — return "Email sending not yet configured. Draft saved."). If false, cancels.

8. `schedule_meeting` — params: `{ title: string, attendees: string[], time: string, duration_minutes?: number, notes?: string }`. Returns meeting details for confirmation. Does NOT create until confirmed. (Stub for now — return "Calendar not yet connected. Details noted: {summary}.")

9. `check_calendar` — params: `{ range: "today" | "tomorrow" | "this_week" | "next_week" }`. (Stub for now — return "Calendar not yet connected.")

10. `get_status_briefing` — no parameters. Pulls case metrics + pending tasks for the caller + any recent audit log entries. Assembles a brief status update.

**Important implementation details:**
- Each tool call MUST write an audit log entry via `logAuditEntry()` from db/queries.ts
- The `draft_email` tool stores the draft in a pending actions map (in-memory for now, keyed by callerIdentity). The `confirm_send_email` tool checks this map.
- Conversation history should include tool_use and tool_result messages so Claude maintains full context
- If the Claude API call fails, return a simple error message: "Something went wrong on my end. Try again in a sec."
- Add proper TypeScript types for all tool parameters and results

### Update: `apps/justice-agent/src/modes/executive.ts`

Modify this file to:
- Remove the import of `parseIntent` from intent-parser (deleted)
- Remove the import of `executeIntent` and `cleanExpiredActions` from action-executor (deleted)
- Import `handleMessage` from `./conversational-engine`
- In `handleExecutiveMessage()`: replace the parseIntent → executeIntent flow with a single call to `handleMessage(phoneNumber, messageText, callerIdentity, session.conversationHistory)`
- Update the conversation history from the returned `updatedHistory`
- Keep everything else: session management, session expiry, the session Map, the runMaintenance export
- Remove `EXECUTIVE_SYSTEM_PROMPT` from this file (it's now in conversational-engine.ts)

### Update: `apps/justice-agent/src/modes/executive-webhook.ts`

- Only change: the voice call handler (see Part 3). The executive webhook route stays exactly as-is.

---

## PART 2 — TIER 3 PII ENCRYPTION + DB INDEXES

### Enable pgcrypto:
Run: `psql justice -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"`

### Add encryption key to environment:
The encryption key will be stored in Doppler as `PII_ENCRYPTION_KEY`. For now, generate one and set it:
```bash
doppler secrets set PII_ENCRYPTION_KEY="$(openssl rand -hex 32)"
```

### Update: `apps/justice-agent/src/db/schema.ts`

Add indexes:
- `cases.tenant_id`
- `cases.status`
- `cases.created_at`
- `tasks.assignee`
- `tasks.status`
- `audit_log.created_at`
- `audit_log.intent_type`

### Create: `apps/justice-agent/src/db/encryption.ts`

Application-level AES-256-GCM encryption for PII fields:
```typescript
// encrypt(plaintext: string): string — returns iv:authTag:ciphertext (hex encoded)
// decrypt(encrypted: string): string — returns plaintext
// Key from process.env.PII_ENCRYPTION_KEY
```

### Update: `apps/justice-agent/src/db/queries.ts`

- `createCase()`: encrypt `caller_phone` before insert using `encrypt()`
- `getCaseBySessionId()`: decrypt `caller_phone` in the returned result using `decrypt()`
- `getCaseMetrics()`: does NOT return caller_phone, so no change needed
- Add: `completeTask(taskId: string)` — sets status='completed', completed_at=now()

### Run migration:
```bash
cd apps/justice-agent
doppler run -- npx drizzle-kit generate
doppler run -- npx drizzle-kit push
cd ../..
```

### Verify:
```bash
psql justice -c "\di" # should show new indexes
```

---

## PART 3 — VOICE CALL HANDLER

### Context:
- ElevenLabs Conversational AI handles the full voice conversation autonomously
- Twilio connects the phone call to ElevenLabs via WebSocket
- The agent's job is: receive Twilio webhook → return TwiML that connects to ElevenLabs → handle post-call webhook with transcript
- ElevenLabs agent ID is in Doppler as `WOLF_LAW_ELEVENLABS_AGENT_ID`
- ElevenLabs API key is in Doppler as `ELEVENLABS_API_KEY`

### Update: `apps/justice-agent/src/modes/executive-webhook.ts`

Add a new route handler in the `handleRequest` function. Add these routes BEFORE the 404 fallback:

**Route: `POST /api/voice/inbound`**
- This is hit by Twilio when someone calls (630) 716-9319
- Read the ElevenLabs agent ID from `process.env.WOLF_LAW_ELEVENLABS_AGENT_ID`
- Return TwiML that connects the call to ElevenLabs Conversational AI via WebSocket:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://api.elevenlabs.io/v1/convai/conversation?agent_id={AGENT_ID}">
      <Parameter name="caller_number" value="{From}" />
    </Stream>
  </Connect>
</Response>
```

Extract `From` from the Twilio form-encoded body (same parser as the executive route). Include the caller's phone number as a stream parameter so ElevenLabs can reference it.

If `WOLF_LAW_ELEVENLABS_AGENT_ID` is not set, return TwiML with a `<Say>` fallback:
```xml
<Response><Say voice="alice">Thank you for calling Wolf Law. We're experiencing technical difficulties. Please try again shortly.</Say></Response>
```

**Route: `POST /api/voice/status`**
- Twilio status callback (call completed, failed, etc.)
- Log the event to console: `[voice] Call {CallSid} status: {CallStatus}`
- Return 200 OK with empty body

**Route: `POST /api/voice/post-call`**
- ElevenLabs post-call webhook with transcript
- Parse JSON body
- Log: `[voice] Post-call transcript received for {session_id}`
- For now, just log the transcript length and store nothing (we'll wire up case creation from transcripts in a future session)
- Return 200 OK with `{ received: true }`

### Wire the orphaned files:

Update `apps/justice-agent/src/integrations/elevenlabs.ts`:
- Remove stub code
- Export a function `getElevenLabsAgentId(tenantId: string): string` that reads from tenant registry → falls back to `WOLF_LAW_ELEVENLABS_AGENT_ID` env var
- Export a function `buildVoiceTwiml(agentId: string, callerNumber: string): string` that returns the TwiML XML string

Import and use these in executive-webhook.ts for the voice routes.

### Update `apps/justice-agent/src/multi-tenancy/tenant-router.ts`:
- Remove stub code
- Export: `routeInboundCall(calledNumber: string, callerNumber: string): { mode: 'executive' | 'voice'; tenantId: string }`
- Logic: if callerNumber is approved (Isaiah/Scott) AND calledNumber matches tenant phone → mode 'executive'. Otherwise → mode 'voice'.
- This is NOT used yet in the webhook (future: unified routing). Just make it importable and correct.

### Clean up remaining orphans:
- `integrations/twilio.ts` — DELETE this file. Its functionality is already in executive-webhook.ts.
- `integrations/claude-api.ts` — DELETE this file. Claude calls are now in conversational-engine.ts.
- `integrations/casetext.ts` — DELETE this file. It's a passthrough that nothing imports. The real implementation is in `packages/knowledge-base/src/case-law/casetext-integration.ts`.
- `integrations/calendar-email.ts` — DELETE this file. Calendar and email are now tool stubs in conversational-engine.ts.
- `modes/routing.ts` — keep this file but do NOT modify it. It will be used in Phase 2 attorney routing.
- `modes/voice-agent.ts` — keep this file but do NOT modify it. It contains the voice system prompt builder which ElevenLabs uses separately.

---

## PART 4 — VERIFICATION

After all changes, run these checks:

1. **TypeScript compiles:**
```bash
cd apps/justice-agent && npx tsc --noEmit && cd ../..
```

2. **Agent starts:**
```bash
# Kill existing agent process first, then:
cd ~/Developer/justice-repo
doppler run -- pnpm dev:agent
# Verify: curl -s http://localhost:3002/health
```

3. **Database verification:**
```bash
psql justice -c "\di"  # indexes exist
psql justice -c "SELECT count(*) FROM cases"
psql justice -c "SELECT count(*) FROM tasks"
psql justice -c "SELECT count(*) FROM audit_log"
```

4. **Voice endpoint exists:**
```bash
curl -s -X POST http://localhost:3002/api/voice/inbound \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=%2B15551234567&To=%2B16307169319&CallSid=test123" | head -5
# Should return TwiML with <Connect><Stream>, NOT 404
```

5. **Executive endpoint still works:**
```bash
curl -s -X POST http://localhost:3002/webhook/executive \
  -H "Content-Type: application/json" \
  -d '{"From": "+15551234567", "Body": "test", "Channel": "imessage"}' | head -5
# Should return JSON with reply (will be 403 if number not approved — that's correct)
```

6. **No orphaned imports:**
```bash
# Verify no file imports from deleted files
grep -r "intent-parser\|action-executor\|integrations/twilio\|integrations/claude-api\|integrations/casetext\|integrations/calendar-email" apps/justice-agent/src/ --include="*.ts" | grep -v node_modules
# Should return NOTHING
```

7. **Compliance spot-check:**
```bash
# No forbidden branding in responses
grep -r "Wronged.ai\|wronged\.ai" apps/justice-agent/src/ --include="*.ts" | grep -v "CLAUDE.md\|comment\|//"
# Should return NOTHING in string literals
```

Report all results. If anything fails, fix it before finishing.

---

## FILES CHANGED SUMMARY

**Created:**
- `apps/justice-agent/src/modes/conversational-engine.ts` (NEW — the brain)
- `apps/justice-agent/src/db/encryption.ts` (NEW — PII encryption)

**Modified:**
- `apps/justice-agent/src/modes/executive.ts` (use conversational-engine instead of intent-parser + action-executor)
- `apps/justice-agent/src/modes/executive-webhook.ts` (add voice routes)
- `apps/justice-agent/src/db/schema.ts` (add indexes)
- `apps/justice-agent/src/db/queries.ts` (add encryption, add completeTask)
- `apps/justice-agent/src/integrations/elevenlabs.ts` (real implementation)
- `apps/justice-agent/src/multi-tenancy/tenant-router.ts` (real implementation)

**Deleted:**
- `apps/justice-agent/src/modes/intent-parser.ts`
- `apps/justice-agent/src/modes/action-executor.ts`
- `apps/justice-agent/src/integrations/twilio.ts`
- `apps/justice-agent/src/integrations/claude-api.ts`
- `apps/justice-agent/src/integrations/casetext.ts`
- `apps/justice-agent/src/integrations/calendar-email.ts`

**NOT touched:**
- All `packages/*` files
- `scripts/justice-imessage-listener.sh`
- `apps/justice-agent/src/access-control/approved-numbers.ts`
- `apps/justice-agent/src/db/connection.ts`
- `apps/justice-agent/src/multi-tenancy/tenant-registry.ts`
- `apps/justice-agent/src/modes/routing.ts`
- `apps/justice-agent/src/modes/voice-agent.ts`
