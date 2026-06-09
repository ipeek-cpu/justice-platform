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
const ROWID_FILE = '/tmp/justice_last_rowid';
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
  let lastRowid = 0;
  try { lastRowid = parseInt(fs.readFileSync(ROWID_FILE, 'utf8').trim(), 10) || 0; } catch {}
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

  for (const row of rows) {
    const sender = normalizePhone(row.sender);

    if (!approved.includes(sender)) {
      fs.writeFileSync(ROWID_FILE, String(row.ROWID));
      continue;
    }

    // Resolve message text: prefer text column, fall back to attributedBody hex
    const messageText = (row.text && row.text.trim())
      ? row.text
      : extractTextFromAttributedBodyHex(row.attributedBodyHex);

    if (!messageText) {
      log(`Skipping rowid ${row.ROWID} — no extractable text`);
      fs.writeFileSync(ROWID_FILE, String(row.ROWID));
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

    // Send reply via AppleScript
    if (reply) {
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
        log(`Reply sent to ${sender}: ${reply.slice(0, 50)}${reply.length > 50 ? '...' : ''}`);
      } catch (err) {
        logError(`osascript failed for sender=${sender}: ${err.message}`);
      }
    }

    fs.writeFileSync(ROWID_FILE, String(row.ROWID));
  }
}

main().catch(err => logError(`Fatal: ${err.message}`));
