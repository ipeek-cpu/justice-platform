#!/bin/bash
# Build + ad-hoc-sign the stable FDA wrapper for the iMessage listener.
# The output binary path is FIXED so the Full Disk Access grant survives
# node upgrades. Re-run this only if you change the wrapper .c source.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)/justice-imessage-listener-wrapper.c"
OUT="$HOME/.local/bin/justice-imessage-listener"

mkdir -p "$(dirname "$OUT")"
clang -O2 -o "$OUT" "$SRC"
codesign -s - --force "$OUT"

echo "Built + signed: $OUT"
codesign -dv "$OUT" 2>&1 | grep -E 'Identifier|Signature' || true
