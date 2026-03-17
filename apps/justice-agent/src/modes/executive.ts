/**
 * Executive Assistant — Mode 1
 *
 * Full inbound iMessage loop:
 * 1. Twilio webhook receives inbound SMS/iMessage
 * 2. Approved numbers check (Isaiah + Scott only)
 * 3. Conversational engine handles message via Claude tool_use
 * 4. iMessage confirmation sent back to caller
 *
 * Security:
 * - Mode 1 restricted to APPROVED_NUMBER_ISAIAH and APPROVED_NUMBER_SCOTT
 * - All actions logged for audit trail
 * - Destructive actions require explicit confirmation
 * - Emails NEVER sent without confirmation
 * - Never share case data with unauthorized parties
 */

import { isApprovedNumber, getCallerIdentity } from '../access-control/approved-numbers';
import { handleMessage, type ConversationMessage } from './conversational-engine';
import { logAuditEntry } from '../db/queries';

export interface ExecutiveSession {
  callerIdentity: 'isaiah' | 'scott';
  phoneNumber: string;
  conversationHistory: ConversationMessage[];
  createdAt: string;
  lastActivityAt: string;
}

// In-memory session store keyed by phone number (replace with Redis in production)
const sessions = new Map<string, ExecutiveSession>();

/**
 * Main entry point for the executive assistant loop.
 * Called by the Twilio webhook handler after access control passes.
 */
export async function handleExecutiveMessage(
  phoneNumber: string,
  messageText: string
): Promise<{ response: string; blocked: boolean }> {
  // Step 1: Access control
  if (!isApprovedNumber(phoneNumber)) {
    logAuditEntry({
      caller: 'unknown',
      intentType: 'access_denied',
      action: 'blocked',
      result: 'failed',
      details: 'Unauthorized number attempted Mode 1 access',
    }).catch(err => console.error('[executive] Audit log write failed:', err));
    return {
      response: '',
      blocked: true,
    };
  }

  // Step 2: Identify caller
  const callerIdentity = getCallerIdentity(phoneNumber);
  if (!callerIdentity) {
    return { response: '', blocked: true };
  }

  // Step 3: Get or create session
  const session = getOrCreateSession(phoneNumber, callerIdentity);

  // Step 4: Handle message via conversational engine
  const { response, updatedHistory } = await handleMessage(
    phoneNumber,
    messageText,
    callerIdentity,
    session.conversationHistory
  );

  // Step 5: Update session state
  session.conversationHistory = updatedHistory;
  session.lastActivityAt = new Date().toISOString();

  // Trim conversation history to last 20 messages to avoid token bloat
  if (session.conversationHistory.length > 20) {
    session.conversationHistory = session.conversationHistory.slice(-20);
  }

  return {
    response,
    blocked: false,
  };
}

function getOrCreateSession(phoneNumber: string, identity: 'isaiah' | 'scott'): ExecutiveSession {
  let session = sessions.get(phoneNumber);

  if (session) {
    // Expire session after 2 hours of inactivity
    const lastActivity = new Date(session.lastActivityAt);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    if (lastActivity < twoHoursAgo) {
      session = undefined;
    }
  }

  if (!session) {
    session = {
      callerIdentity: identity,
      phoneNumber,
      conversationHistory: [],
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };
    sessions.set(phoneNumber, session);
  }

  return session;
}

export function getSession(phoneNumber: string): ExecutiveSession | undefined {
  return sessions.get(phoneNumber);
}

export function validateCaller(phoneNumber: string): boolean {
  return isApprovedNumber(phoneNumber);
}

// Periodic cleanup — no-op now that pending actions are handled inside the engine
export function runMaintenance(): void {
  // Expire stale sessions
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  for (const [phone, session] of sessions) {
    if (new Date(session.lastActivityAt) < twoHoursAgo) {
      sessions.delete(phone);
    }
  }
}
