/**
 * Google Workspace integration — OAuth2, Calendar, and Gmail.
 *
 * Multi-account support:
 * - Each user (isaiah/scott) can connect multiple Google accounts
 * - One account is marked isPrimary (wolflaw.ai)
 * - Calendar reads merge events from ALL connected accounts
 * - Calendar writes and email default to primary
 * - Email can target a specific account via fromAccount param
 *
 * Tokens are encrypted at rest (Tier 3) via encryption.ts.
 */

import { google } from 'googleapis';
import {
  getPrimaryOAuthToken,
  getOAuthTokenByEmail,
  getAllOAuthTokens,
  upsertOAuthToken,
} from '../db/queries';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
];

function createOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth credentials not set (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Generate the Google OAuth consent URL.
 * Pass callerIdentity as state so callback knows who authorized.
 */
export function getAuthUrl(callerIdentity: string): string {
  const oauth2 = createOAuth2Client();
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state: callerIdentity,
  });
}

/**
 * Handle OAuth callback — exchange code for tokens, fetch email, store.
 * Auto-detects if this should be the primary account (@wolflaw.ai or first connected).
 */
export async function handleOAuthCallback(
  code: string,
  callerIdentity: string
): Promise<{ success: boolean; email?: string; error?: string }> {
  try {
    const oauth2 = createOAuth2Client();
    const { tokens } = await oauth2.getToken(code);

    if (!tokens.refresh_token) {
      return { success: false, error: 'No refresh token received — try revoking app access in Google Account settings and re-authorizing' };
    }

    // Fetch the authenticated user's email address
    oauth2.setCredentials(tokens);
    const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2 });
    const userInfo = await oauth2Api.userinfo.get();
    const accountEmail = userInfo.data.email;
    if (!accountEmail) {
      return { success: false, error: 'Could not determine Google account email' };
    }

    // Determine if this should be primary
    const existing = await getAllOAuthTokens(callerIdentity);
    const isWolflaw = accountEmail.endsWith('@wolflaw.ai');
    const isPrimary = isWolflaw || existing.length === 0;

    // If this account is becoming primary, demote any existing primary
    if (isPrimary && existing.some(t => t.isPrimary && t.accountEmail !== accountEmail)) {
      for (const t of existing.filter(t => t.isPrimary)) {
        await upsertOAuthToken({
          userIdentity: callerIdentity,
          accountEmail: t.accountEmail,
          isPrimary: false,
          accessToken: t.accessToken,
          refreshToken: t.refreshToken,
          expiresAt: t.expiresAt ?? undefined,
        });
      }
    }

    await upsertOAuthToken({
      userIdentity: callerIdentity,
      accountEmail,
      isPrimary,
      accessToken: tokens.access_token ?? '',
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
    });

    console.log(`[google] Connected ${accountEmail} for ${callerIdentity} (primary=${isPrimary})`);
    return { success: true, email: accountEmail };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'OAuth callback failed' };
  }
}

/**
 * Get an authenticated OAuth2 client for a user.
 * If accountEmail is provided, uses that specific account.
 * Otherwise uses the primary account.
 */
async function getAuthedClient(callerIdentity: string, accountEmail?: string) {
  const stored = accountEmail
    ? await getOAuthTokenByEmail(callerIdentity, accountEmail)
    : await getPrimaryOAuthToken(callerIdentity);

  if (!stored) {
    const label = accountEmail ? `account ${accountEmail}` : 'primary account';
    throw new Error(`No Google auth for ${callerIdentity} (${label}) — visit /api/oauth/google/authorize?user=${callerIdentity}`);
  }

  const oauth2 = createOAuth2Client();
  oauth2.setCredentials({
    access_token: stored.accessToken,
    refresh_token: stored.refreshToken,
    expiry_date: stored.expiresAt?.getTime(),
  });

  // Auto-refresh: save new tokens
  oauth2.on('tokens', async (tokens) => {
    if (tokens.refresh_token || tokens.access_token) {
      await upsertOAuthToken({
        userIdentity: callerIdentity,
        accountEmail: stored.accountEmail,
        isPrimary: stored.isPrimary,
        accessToken: tokens.access_token ?? stored.accessToken,
        refreshToken: tokens.refresh_token ?? stored.refreshToken,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
      }).catch(err => console.error('[google] Token refresh save failed:', err));
    }
  });

  return oauth2;
}

// --- Calendar ---

/**
 * Get calendar events merged from ALL connected accounts.
 * Each event is tagged with which account it came from.
 */
export async function getCalendarEvents(
  callerIdentity: string,
  timeMin: string,
  timeMax: string
): Promise<{ events: Array<{ id: string; summary: string; start: string; end: string; attendees: string[]; account: string }> } | { error: string }> {
  try {
    const allTokens = await getAllOAuthTokens(callerIdentity);
    if (allTokens.length === 0) {
      return { error: `No Google accounts connected for ${callerIdentity} — visit /api/oauth/google/authorize?user=${callerIdentity}` };
    }

    const allEvents: Array<{ id: string; summary: string; start: string; end: string; attendees: string[]; account: string }> = [];

    for (const token of allTokens) {
      try {
        const auth = await getAuthedClient(callerIdentity, token.accountEmail);
        const calendar = google.calendar({ version: 'v3', auth });

        const response = await calendar.events.list({
          calendarId: 'primary',
          timeMin,
          timeMax,
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 20,
        });

        const events = (response.data.items ?? []).map(event => ({
          id: event.id ?? '',
          summary: event.summary ?? '(no title)',
          start: event.start?.dateTime ?? event.start?.date ?? '',
          end: event.end?.dateTime ?? event.end?.date ?? '',
          attendees: (event.attendees ?? []).map(a => a.email ?? '').filter(Boolean),
          account: token.accountEmail,
        }));

        allEvents.push(...events);
      } catch (err) {
        console.error(`[google] Calendar fetch failed for ${token.accountEmail}:`, err);
      }
    }

    // Sort by start time
    allEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    return { events: allEvents };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Calendar fetch failed' };
  }
}

/**
 * Create a calendar event on the PRIMARY account.
 */
export async function createCalendarEvent(
  callerIdentity: string,
  event: { title: string; attendees: string[]; startTime: string; endTime: string; notes?: string }
): Promise<{ id: string; link: string } | { error: string }> {
  try {
    const auth = await getAuthedClient(callerIdentity);
    const calendar = google.calendar({ version: 'v3', auth });

    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: event.title,
        description: event.notes,
        start: { dateTime: event.startTime },
        end: { dateTime: event.endTime },
        attendees: event.attendees.map(email => ({ email })),
      },
    });

    return {
      id: response.data.id ?? '',
      link: response.data.htmlLink ?? '',
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Calendar event creation failed' };
  }
}

// --- Gmail ---

/**
 * Send email via Gmail API.
 * Uses fromAccount if specified, otherwise primary account.
 */
export async function sendGmail(
  callerIdentity: string,
  to: string[],
  subject: string,
  body: string,
  fromAccount?: string
): Promise<{ messageId: string; sentFrom: string } | { error: string }> {
  try {
    const auth = await getAuthedClient(callerIdentity, fromAccount);
    const gmail = google.gmail({ version: 'v1', auth });

    const toHeader = to.join(', ');
    const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const raw = Buffer.from(
      `To: ${toHeader}\r\nSubject: ${encodedSubject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
    ).toString('base64url');

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    // Determine which account actually sent
    const token = fromAccount
      ? await getOAuthTokenByEmail(callerIdentity, fromAccount)
      : await getPrimaryOAuthToken(callerIdentity);
    const sentFrom = token?.accountEmail ?? 'unknown';

    return { messageId: response.data.id ?? '', sentFrom };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Gmail send failed' };
  }
}

/**
 * Send email with file attachment via Gmail API.
 */
export async function sendGmailWithAttachment(
  callerIdentity: string,
  to: string[],
  subject: string,
  body: string,
  attachment: { filename: string; path: string; mimeType: string },
  fromAccount?: string
): Promise<{ messageId: string; sentFrom: string } | { error: string }> {
  try {
    const fs = require('fs');
    const auth = await getAuthedClient(callerIdentity, fromAccount);
    const gmail = google.gmail({ version: 'v1', auth });

    const toHeader = to.join(', ');
    const boundary = `boundary_${Date.now()}`;
    const fileContent = fs.readFileSync(attachment.path);
    const encodedFile = fileContent.toString('base64');

    // RFC 2047 encode subject for non-ASCII safety
    const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;

    const rawParts = [
      `From: Justice <justice@wolflaw.ai>`,
      `To: ${toHeader}`,
      `Subject: ${encodedSubject}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      body,
      `--${boundary}`,
      `Content-Type: ${attachment.mimeType}`,
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      encodedFile,
      `--${boundary}--`,
    ].join('\r\n');

    const raw = Buffer.from(rawParts).toString('base64url');

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    const token = fromAccount
      ? await getOAuthTokenByEmail(callerIdentity, fromAccount)
      : await getPrimaryOAuthToken(callerIdentity);
    const sentFrom = token?.accountEmail ?? 'unknown';

    return { messageId: response.data.id ?? '', sentFrom };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Gmail send with attachment failed' };
  }
}

/**
 * Check if a user has any Google OAuth tokens stored.
 */
export async function hasGoogleAuth(callerIdentity: string): Promise<boolean> {
  const tokens = await getAllOAuthTokens(callerIdentity);
  return tokens.length > 0;
}

/**
 * Get the list of connected Google account emails for a user.
 */
export async function getConnectedAccounts(callerIdentity: string): Promise<Array<{ email: string; isPrimary: boolean }>> {
  const tokens = await getAllOAuthTokens(callerIdentity);
  return tokens.map(t => ({ email: t.accountEmail, isPrimary: t.isPrimary }));
}
