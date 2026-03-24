#!/bin/bash
# Justice iMessage Listener — Bash wrapper
# Queries chat.db (requires Full Disk Access via bash) and pipes JSON to Node.js
# Node handles: phone normalization, webhook POST, AppleScript replies, logging

cd /Users/justicewolf/Developer/justice-repo

LAST_ROWID=$(cat /tmp/justice_last_rowid 2>/dev/null || echo "0")
DB="file:$HOME/Library/Messages/chat.db?mode=ro"

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
