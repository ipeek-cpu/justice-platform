#!/bin/bash
# Justice Agent launcher for the login LaunchAgent (ai.wolflaw.justice.agent).
#
# Starts the executive webhook + voice/routing agent (Mode 1/2/3) on port 3002
# with Doppler-provided env. Invoked by launchd at login and kept alive on
# crash. The agent does NOT read chat.db, so no Full Disk Access is required —
# it only needs node/pnpm/doppler on PATH and the repo's Doppler config.
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd /Users/justicewolf/Developer/justice-repo/apps/justice-agent

# Run tsx WITHOUT watch: for a daemon we want a crash to collapse the whole
# process tree so launchd's KeepAlive restarts it. `pnpm dev` uses `tsx watch`,
# whose supervisor keeps the parent alive after a child crash and defeats
# KeepAlive. `exec` so the doppler→tsx→node tree replaces this shell and launchd
# tracks/signals it directly.
exec /opt/homebrew/bin/doppler run -- /opt/homebrew/bin/pnpm exec tsx src/index.ts
