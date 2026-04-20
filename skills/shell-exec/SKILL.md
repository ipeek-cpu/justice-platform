# Shell Exec Skill

Direct shell command execution on the Mac Mini.
Use when you need to run git, bd, gh, or file operations directly.

## Import
```typescript
import { shellExec } from '../integrations/shell-exec';
```

## Usage
```typescript
const result = await shellExec('bd create "task title" -t task -p 1', {
  cwd: '/path/to/project'  // optional
});
if (result.exitCode === 0) {
  console.log(result.stdout);
}
```

## Allowed command prefixes
git, bd, gh, xcodebuild, xcode-select, redis-cli, echo, cat, ls,
mkdir, rm -f, mv, cp, grep, find, python3, node, doppler secrets,
curl, sed, chmod, touch, tail, head

## Blocked (always rejected)
- sudo
- rm -rf / or rm -rf ~
- pipe to sh/bash
- curl pipe to shell

## Common operations
```
git -C [path] rm --cached [file]     remove file from git index
git -C [path] rm -r --cached [dir]   remove directory from git index
bd create "title" -t task -p 1       create a bead
bd reopen [id] --reason "..."        reopen a bead
bd show [id] --json                  get bead details
gh pr view [num] --repo [owner/repo] view a PR
gh issue list --repo [owner/repo]    list issues
```

## All executions are logged to execution-log.jsonl
