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
  LAST_ROWID=$(sqlite3 "$DB" "SELECT IFNULL(MAX(rowid),0) FROM message" 2>/dev/null || echo "0")
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
