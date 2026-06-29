#!/usr/bin/env node
'use strict';

/**
 * Justice iMessage Listener — Node.js processor
 *
 * Reads JSON rows from stdin (piped from sqlite3 -json via bash wrapper).
 * Handles: phone normalization, approved-number filtering, webhook POST,
 * AppleScript reply sending, and logging.
 *
 * Unicode, emojis, and multi-line messages are handled correctly because:
 * - sqlite3 -json outputs proper JSON strings (escapes built-in)
 * - JSON.parse/JSON.stringify handle all encoding natively
 * - AppleScript sanitization is explicit and tested
 */

const { execSync } = require('child_process');
const fs = require('fs');

// --- Config ---
const MEMORY_DIR = `${process.env.HOME}/Developer/justice-repo/memory`;
// Watermark lives in the repo (NOT /tmp). /tmp is wiped on reboot, which made a
// cold start fall back to rowid 0 and replay the ENTIRE inbound backlog,
// re-replying to every stored message — the worst flood vector. See plan.
const ROWID_FILE = `${MEMORY_DIR}/.justice_last_rowid`;
// Kill-switch sentinel — shared with the agent's send-guard (PAUSE_SENTINEL).
const PAUSE_SENTINEL = `${MEMORY_DIR}/OUTBOUND_PAUSE`;
// Reply throttle state (per-day count + dedup) — defense in depth, since each
// listener invocation is a fresh 5s process with no in-memory continuity.
const STATE_FILE = `${MEMORY_DIR}/.justice_listener_state.json`;
const REPLY_DAILY_MAX = 30;
const LOG_FILE = '/tmp/justice-imessage.log';
const ERROR_LOG = '/tmp/justice-imessage-error.log';
const WEBHOOK_URL = 'http://localhost:3002/webhook/executive';
const CHAT_DB = `file:${process.env.HOME}/Library/Messages/chat.db?mode=ro`;
const SQLITE3 = '/usr/bin/sqlite3';

// --- Helpers ---
function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  fs.appendFileSync(LOG_FILE, `[${ts}] ${msg}\n`);
}

function logError(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  fs.appendFileSync(ERROR_LOG, `[${ts}] ${msg}\n`);
}

function normalizePhone(raw) {
  let clean = raw.replace(/[\s\-()]/g, '');
  if (/^\d{10}$/.test(clean)) clean = '+1' + clean;
  else if (/^1\d{10}$/.test(clean)) clean = '+' + clean;
  return clean;
}

/**
 * Extract plain text from NSAttributedString hex dump.
 * Structure: ...4E53537472696E67 019484012B [length] [UTF-8 text bytes] 8684...
 * The marker "4E53537472696E67019484012B" = "NSString" + typedstream header.
 */
function extractTextFromAttributedBodyHex(hex) {
  if (!hex) return null;
  // Try NSString marker (simple messages)
  // Then NSMutableString+NSString marker (rich messages with calendar data, links, etc.)
  const markers = [
    '4E53537472696E67019484012B',                                         // NSString + header
    '4E534D757461626C65537472696E67018484084E53537472696E67019584012B',   // NSMutableString + NSString + header
  ];
  let afterMarker = null;
  for (const marker of markers) {
    const idx = hex.indexOf(marker);
    if (idx !== -1) {
      afterMarker = hex.substring(idx + marker.length);
      break;
    }
  }
  if (!afterMarker) return null;
  // Typedstream integer encoding for string length:
  //   < 0x80: direct 1-byte value (0–127)
  //   0x81:   next 2 bytes = uint16 little-endian
  //   0x82:   next 4 bytes = uint32 little-endian
  const lenByte = parseInt(afterMarker.substring(0, 2), 16);
  let strLen, offset;
  if (lenByte < 0x80) {
    strLen = lenByte;
    offset = 2; // 1 byte = 2 hex chars
  } else if (lenByte === 0x81) {
    const lo = parseInt(afterMarker.substring(2, 4), 16);
    const hi = parseInt(afterMarker.substring(4, 6), 16);
    strLen = (hi << 8) | lo;
    offset = 6; // 3 bytes = 6 hex chars
  } else if (lenByte === 0x82) {
    const b0 = parseInt(afterMarker.substring(2, 4), 16);
    const b1 = parseInt(afterMarker.substring(4, 6), 16);
    const b2 = parseInt(afterMarker.substring(6, 8), 16);
    const b3 = parseInt(afterMarker.substring(8, 10), 16);
    strLen = (b3 << 24) | (b2 << 16) | (b1 << 8) | b0;
    offset = 10; // 5 bytes = 10 hex chars
  } else {
    return null;
  }
  const textHex = afterMarker.substring(offset, offset + strLen * 2);
  try {
    return Buffer.from(textHex, 'hex').toString('utf8');
  } catch {
    return null;
  }
}

function sanitizeForAppleScript(text) {
  return text
    .replace(/\*\*/g, '')           // strip markdown bold markers
    .replace(/\\/g, '\\\\')         // escape backslashes
    .replace(/"/g, '\\"')           // escape double quotes
    .replace(/\n/g, '\\n');         // escape newlines
}

function getDopplerSecret(name) {
  try {
    return execSync(`/opt/homebrew/bin/doppler secrets get ${name} --plain`, {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Kill-switch. Muted if the local sentinel file exists OR Doppler says pause.
 * The listener has no Doppler env injected, so it reads the secret on demand.
 */
function isPaused() {
  if (fs.existsSync(PAUSE_SENTINEL)) return true;
  return (process.env.JUSTICE_OUTBOUND_PAUSE || getDopplerSecret('JUSTICE_OUTBOUND_PAUSE')) === 'true';
}

/**
 * Resolve the last-processed rowid. Reads the persisted watermark; on a cold
 * start (missing/invalid file) it SEEDS to the current MAX(rowid) so history is
 * never replayed. Returns null only if even the seed query fails — callers must
 * then SKIP the cycle rather than fall back to 0.
 */
function getLastRowid() {
  try {
    const v = parseInt(fs.readFileSync(ROWID_FILE, 'utf8').trim(), 10);
    if (Number.isFinite(v) && v > 0) return v;
  } catch {}
  try {
    const out = execSync(`${SQLITE3} "${CHAT_DB}" "SELECT IFNULL(MAX(rowid),0) FROM message"`, {
      encoding: 'utf8', timeout: 8000,
    }).trim();
    const maxId = parseInt(out, 10);
    if (Number.isFinite(maxId)) {
      writeRowid(maxId);
      log(`Cold start — seeded watermark to MAX(rowid)=${maxId} (no backlog replay)`);
      return maxId;
    }
  } catch (err) {
    logError(`MAX(rowid) seed failed: ${err.message}`);
  }
  return null;
}

function writeRowid(rowid) {
  try { fs.mkdirSync(MEMORY_DIR, { recursive: true }); } catch {}
  fs.writeFileSync(ROWID_FILE, String(rowid));
}

function todayCT() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

function readReplyState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (s && s.day === todayCT()) return { day: s.day, replyCount: s.replyCount || 0, hashes: s.hashes || [] };
  } catch {}
  return { day: todayCT(), replyCount: 0, hashes: [] };
}

function writeReplyState(state) {
  try {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch (err) {
    // Don't throw — a state-write failure must not abort the loop before the
    // watermark advances (which would reprocess and risk a duplicate reply).
    logError(`reply-state write failed: ${err.message}`);
  }
}

/** Simple stable hash (djb2) of sender+reply for same-day dedup. */
function replyHash(sender, reply) {
  let h = 5381;
  const s = `${sender} ${reply}`;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim()));
    // If no pipe / empty input, resolve after a short timeout
    setTimeout(() => resolve(data.trim()), 1000);
  });
}

/**
 * Query chat.db directly for new inbound messages. Used when the listener is
 * launched without a stdin pipe (e.g. by node directly from the LaunchAgent).
 * The system sqlite3 runs as a child of node and inherits node's Full Disk
 * Access, so this works under launchd once node is granted FDA — no /bin/bash
 * (which can't be granted FDA) is involved.
 */
function readNewMessagesFromDb() {
  const lastRowid = getLastRowid();
  if (lastRowid === null) {
    logError('Could not resolve watermark — skipping cycle (refusing to default to 0)');
    return [];
  }
  const sql = `SELECT m.rowid AS ROWID, m.text, hex(m.attributedBody) AS attributedBodyHex, h.id AS sender `
    + `FROM message m JOIN handle h ON m.handle_id = h.rowid `
    + `WHERE m.rowid > ${lastRowid} AND m.is_from_me = 0 `
    + `AND (m.text IS NOT NULL OR m.attributedBody IS NOT NULL) `
    + `ORDER BY m.rowid ASC LIMIT 20`;
  try {
    const out = execSync(`${SQLITE3} -json "${CHAT_DB}" "${sql}"`, { encoding: 'utf8', timeout: 8000 }).trim();
    return out ? JSON.parse(out) : [];
  } catch (err) {
    logError(`chat.db read failed: ${err.message}`);
    return [];
  }
}

// --- Main ---
async function main() {
  // Rows arrive via stdin (bash wrapper pipes sqlite3 -json) OR, when launched
  // directly by node (LaunchAgent with Full Disk Access), we read chat.db here.
  const input = await readStdin();

  let rows;
  if (input) {
    try {
      rows = JSON.parse(input);
    } catch (err) {
      logError(`Failed to parse stdin JSON: ${err.message}`);
      return;
    }
  } else {
    rows = readNewMessagesFromDb();
  }

  if (!Array.isArray(rows) || rows.length === 0) return;

  // Fetch approved numbers from Doppler
  const approved = [
    process.env.APPROVED_NUMBER_ISAIAH || getDopplerSecret('APPROVED_NUMBER_ISAIAH'),
    process.env.APPROVED_NUMBER_SCOTT || getDopplerSecret('APPROVED_NUMBER_SCOTT'),
  ].filter(Boolean);

  if (approved.length === 0) {
    logError('No approved numbers in env or Doppler — skipping');
    return;
  }

  // Kill-switch: when paused, still drain the queue (advance the watermark so
  // paused messages aren't reprocessed later) but send NOTHING and skip the
  // webhook (which can itself trigger guarded sends).
  const paused = isPaused();
  if (paused) log('OUTBOUND PAUSED — advancing watermark without replying');

  const replyState = readReplyState();

  for (const row of rows) {
    const sender = normalizePhone(row.sender);

    if (!approved.includes(sender)) {
      writeRowid(row.ROWID);
      continue;
    }

    if (paused) {
      writeRowid(row.ROWID);
      continue;
    }

    // Resolve message text: prefer text column, fall back to attributedBody hex
    const messageText = (row.text && row.text.trim())
      ? row.text
      : extractTextFromAttributedBodyHex(row.attributedBodyHex);

    if (!messageText) {
      log(`Skipping rowid ${row.ROWID} — no extractable text`);
      writeRowid(row.ROWID);
      continue;
    }

    // Attach resolved text for downstream use
    row.text = messageText;

    log(`Message from ${sender}: ${row.text.slice(0, 50)}${row.text.length > 50 ? '...' : ''}`);

    // POST to webhook — JSON.stringify handles all Unicode/emoji/newlines
    let reply = '';
    try {
      const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          From: sender,
          Body: row.text,
          Channel: 'imessage',
        }),
      });
      const data = await res.json();
      reply = data.reply || '';
    } catch (err) {
      logError(`Webhook failed for ${sender}: ${err.message}`);
    }

    // Send reply via AppleScript — throttled and deduped (defense in depth;
    // these replies bypass the agent's send-guard, so they get their own caps).
    if (reply) {
      const hash = replyHash(sender, reply);
      if (replyState.replyCount >= REPLY_DAILY_MAX) {
        logError(`Reply cap ${REPLY_DAILY_MAX}/day reached — suppressing reply to ${sender}`);
      } else if (replyState.hashes.includes(hash)) {
        log(`Duplicate reply suppressed for ${sender} (same body already sent today)`);
      } else {
        const sanitized = sanitizeForAppleScript(reply);
        const originalSender = row.sender; // use original handle ID for AppleScript
        const script = `
          tell application "Messages"
            set targetService to 1st service whose service type = iMessage
            set targetBuddy to buddy "${originalSender}" of targetService
            send "${sanitized}" to targetBuddy
          end tell
        `.replace(/'/g, "'\\''");

        try {
          execSync(`osascript -e '${script}'`, { timeout: 10000 });
          replyState.replyCount++;
          replyState.hashes.push(hash);
          writeReplyState(replyState);
          log(`Reply sent to ${sender}: ${reply.slice(0, 50)}${reply.length > 50 ? '...' : ''}`);
        } catch (err) {
          logError(`osascript failed for sender=${sender}: ${err.message}`);
        }
      }
    }

    writeRowid(row.ROWID);
  }
}

main().catch(err => logError(`Fatal: ${err.message}`));
