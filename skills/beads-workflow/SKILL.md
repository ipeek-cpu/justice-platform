# Beads Workflow

## Session Start
```
bd ready                          → what to work on now
bd list --label pattern --limit 5 → top patterns to apply
```

## Task Lifecycle
```
bd create "Task name" -t task -p 1   → create task
bd claim bd-[id]                      → start working
bd close bd-[id] --reason "done"     → complete
bd update bd-[id] --status blocked   → blocked
```

## Epic + Task Grouping
- Create an epic for multi-phase work: `bd create "Epic name" -t epic -p 2`
- Link tasks to epics: `bd create "Sub-task" -t task -p 1 --parent bd-[epic-id]`
- View epic progress: `bd show bd-[epic-id]`

## Pattern Recording
After completing a task, record what you learned:
```
bd create "Pattern: [type] — [description]" -t pattern -p 4 --label pattern
```

## Rules
- Never skip `bd claim` — always claim before working
- Never use markdown plan files for tracking — use beads
- Always record patterns after completing non-trivial tasks
- Use priority levels: 1 (critical), 2 (high), 3 (normal), 4 (low)
