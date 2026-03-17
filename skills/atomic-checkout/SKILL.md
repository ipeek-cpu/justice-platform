# Atomic Task Checkout

## Purpose
Prevent two Claude Code subprocesses from working the same beadId concurrently.
Uses Redis SET NX (atomic) with TTL-based expiry as a dead-agent failsafe.

## Import
```typescript
import { atomicClaim, renewClaim, releaseTask, cleanupTask, listActiveCheckouts } from '@justice/shared-types';
```

## Usage
```typescript
// Phase 1 only — claim the task
const claimed = await atomicClaim(beadId, sessionId);
if (!claimed) {
  // Already running elsewhere — notify Isaiah, do NOT proceed
  return;
}

// During execution — renew every 15 min
const renewInterval = setInterval(() => {
  renewClaim(beadId, sessionId).catch(console.error);
}, 15 * 60 * 1000);

// On completion or failure — release
clearInterval(renewInterval);
await cleanupTask(beadId, sessionId);
```

## Redis Key Format
- Key: `justice:task:{beadId}:owner`
- Value: agentId (sessionId)
- TTL: 3600 seconds (1 hour), renewed every 15 minutes

## Functions
| Function | Purpose |
|----------|---------|
| `atomicClaim(beadId, agentId)` | SET NX — returns false if already claimed |
| `renewClaim(beadId, agentId)` | Extend TTL if you are the owner |
| `releaseTask(beadId, agentId)` | Delete key only if you are the owner |
| `cleanupTask(beadId, agentId)` | Release + log cleanup |
| `listActiveCheckouts()` | KEYS scan — returns all active locks |

## Integration
- Wired into `code-executor.ts` — claims on phase 1, renews on interval, releases on close
- `checkout_status` tool in conversational engine — lists active checkouts via iMessage

## Rules
- Only check claim on phase 1 — session already owns it after that
- If claim fails, notify Isaiah and skip — never force-claim
- If agent crashes, TTL expires and lock auto-releases
- Never run two Claude Code subprocesses on the same beadId
