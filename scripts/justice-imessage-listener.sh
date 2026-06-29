#!/bin/bash
# Justice iMessage Listener — Bash wrapper
# Queries chat.db (requires Full Disk Access via bash) and pipes JSON to Node.js
# Node handles: phone normalization, webhook POST, AppleScript replies, logging

cd /Users/justicewolf/Developer/justice-repo

DB="file:$HOME/Library/Messages/chat.db?mode=ro"
# Watermark lives in the repo (NOT /tmp, which is wiped on reboot). On a cold
# start with no watermark, seed to the CURRENT MAX(rowid) so we never replay the
# inbound backlog. Mirrors getLastRowid() in justice-imessage-listener.js.
ROWID_FILE="$HOME/Developer/justice-repo/memory/.justice_last_rowid"
LAST_ROWID=$(cat "$ROWID_FILE" 2>/dev/null)
if ! [[ "$LAST_ROWID" =~ ^[0-9]+$ ]] || [ "$LAST_ROWID" -le 0 ]; then
  # Cold start: seed to current MAX(rowid). If that query fails, EXIT rather than
  # default to 0 — defaulting to 0 would replay the entire inbound backlog.
  # Mirrors getLastRowid()'s "refuse to default to 0" contract in the .js path.
  SEED=$(sqlite3 "$DB" "SELECT IFNULL(MAX(rowid),0) FROM message" 2>/dev/null)
  if ! [[ "$SEED" =~ ^[0-9]+$ ]]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') MAX(rowid) seed failed — skipping cycle (refusing to default to 0)" >> /tmp/justice-imessage-error.log
    exit 0
  fi
  LAST_ROWID="$SEED"
  echo "$LAST_ROWID" > "$ROWID_FILE"
fi

sqlite3 -json "$DB" "
  SELECT m.rowid AS ROWID,
    m.text,
    hex(m.attributedBody) AS attributedBodyHex,
    h.id AS sender
  FROM message m
  JOIN handle h ON m.handle_id = h.rowid
  WHERE m.rowid > $LAST_ROWID
    AND m.is_from_me = 0
    AND (m.text IS NOT NULL OR m.attributedBody IS NOT NULL)
  ORDER BY m.rowid ASC
  LIMIT 20
" 2>/dev/null | /opt/homebrew/bin/node scripts/justice-imessage-listener.js
