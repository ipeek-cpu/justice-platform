# Observability — Justice Execution Monitoring

> ⚠️ **DEPRECATED (2026-06-09).** The stuck-task detection and `unstick_task`
> flow documented here are part of the autonomous-batch pipeline, which is
> disabled by default behind `JUSTICE_AUTONOMOUS_BATCH_ENABLED`. The 8am cron no
> longer emits "may be stuck" pings unless the flag is set. The execution logger
> itself still records events when the pipeline is enabled.

## Layers

### 1. Execution Logger (`execution-logger.ts`)
- Append-only JSONL at `~/Developer/justice-repo/memory/execution-log.jsonl`
- Every bead claim, phase start/complete, commit, build check, approval, failure, and unstick is logged
- `getActiveTasks()` — returns claimed beads that haven't completed or failed
- `getLastEventForBead(beadId)` — last event for a specific bead
- `readRecent(limit)` — tail N events

### 2. Notion Timeline (`logTimelineEvent`)
- Appends timestamped status lines to the Notion task page
- Format: `{emoji} {time CT} — {message}`
- Statuses: success, running, failed, waiting

### 3. iMessage Commands
- `justice status` — shows active tasks, pending approvals, recent events
- `unstick [bead-id]` — kills stuck task, releases checkout, reopens bead

### 4. Stuck Detection (proactive-agent.ts)
- Runs on 8am daily cron via `runProactiveChecks()`
- If any active task has no log event for 30+ minutes, alerts Isaiah
- Alert includes bead ID, project, minutes since last event, and unstick command

## Rules
- Every autonomous action MUST produce at least one execution log entry
- Failed executions MUST reopen the bead (never leave a bead claimed with no work done)
- Notion timeline is append-only — never edit or delete timeline entries
- Stuck detection threshold: 30 minutes with no events
- `justice_status` returns idle/active with task summaries and recent events
