/**
 * Executive Webhook — Handles inbound messages from TWO channels:
 *
 * Channel 1 — Twilio SMS (external callers, routed through Twilio):
 *   POST /webhook/executive  Content-Type: application/x-www-form-urlencoded
 *   Twilio signature validated. Response: empty TwiML + reply via Twilio SMS.
 *
 * Channel 2 — iMessage listener (Isaiah + Scott personal command channel):
 *   POST /webhook/executive  Content-Type: application/json
 *   { "From": "+1...", "Body": "...", "Channel": "imessage" }
 *   No Twilio signature (local only). Response: { "reply": "..." }
 *
 * Voice routes:
 *   POST /api/voice/inbound   — TwiML connecting Twilio to ElevenLabs WebSocket
 *   POST /api/voice/status    — Call status callback
 *   POST /api/voice/post-call — Post-call transcript receipt
 *
 * Both message channels gate on approved numbers (Mode 1 — Isaiah + Scott only).
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { createHmac } from 'crypto';
import { isApprovedNumber } from '../access-control/approved-numbers';
import { handleExecutiveMessage, runMaintenance } from './executive';
import { getElevenLabsAgentId, buildVoiceTwiml } from '../integrations/elevenlabs';
import { getTenantByPhone } from '../multi-tenancy/tenant-registry';
import { getAuthUrl, handleOAuthCallback } from '../integrations/google-workspace';
import { getCallerIdentity } from '../access-control/approved-numbers';
import { parseApprovalReply, formatStamp } from '../integrations/approval-gate';

const PORT = parseInt(process.env.EXECUTIVE_WEBHOOK_PORT ?? '3002', 10);

interface InboundMessage {
  from: string;
  body: string;
  channel: 'sms' | 'imessage';
  messageSid?: string;
}

// --- Body parsers ---

function parseTwilioForm(raw: string): InboundMessage {
  const params = new URLSearchParams(raw);
  return {
    from: params.get('From') ?? '',
    body: params.get('Body') ?? '',
    channel: 'sms',
    messageSid: params.get('MessageSid') ?? undefined,
  };
}

function parseJsonBody(raw: string): InboundMessage {
  const data = JSON.parse(raw);
  return {
    from: data.From ?? '',
    body: data.Body ?? '',
    channel: (data.Channel === 'imessage' ? 'imessage' : 'sms') as 'sms' | 'imessage',
  };
}

// --- Twilio signature validation ---

function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.warn('[executive-webhook] TWILIO_AUTH_TOKEN not set — skipping signature validation');
    return true;
  }

  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  const computed = createHmac('sha1', authToken)
    .update(Buffer.from(data, 'utf-8'))
    .digest('base64');

  return computed === signature;
}

// --- HTTP helpers ---

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: Record<string, unknown>): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function sendTwiml(res: ServerResponse, status = 200, message?: string): void {
  const inner = message ? `<Message>${escapeXml(message)}</Message>` : '';
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
  res.writeHead(status, { 'Content-Type': 'text/xml', 'Content-Length': Buffer.byteLength(twiml) });
  res.end(twiml);
}

function sendXml(res: ServerResponse, status: number, xml: string): void {
  res.writeHead(status, { 'Content-Type': 'text/xml', 'Content-Length': Buffer.byteLength(xml) });
  res.end(xml);
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isJsonRequest(req: IncomingMessage): boolean {
  const ct = req.headers['content-type'] ?? '';
  return ct.includes('application/json');
}

// --- Twilio outbound SMS ---

async function sendTwilioReply(to: string, body: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !from) {
    console.error('[executive-webhook] Twilio credentials not set for SMS reply');
    return;
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    });
    const respBody = await resp.json() as Record<string, unknown>;
    if (!resp.ok) {
      console.error(`[executive-webhook] Twilio SMS reply failed (${resp.status}):`, respBody);
    } else {
      console.log(`[executive-webhook] SMS reply sent to ${to.slice(-4)}, SID=${respBody.sid}`);
    }
  } catch (error) {
    console.error('[executive-webhook] Twilio SMS reply failed:', error);
  }
}

// --- Voice route handlers ---

function handleVoiceInbound(req: IncomingMessage, res: ServerResponse, rawBody: string): void {
  const params = new URLSearchParams(rawBody);
  const callerNumber = params.get('From') ?? '';
  const calledNumber = params.get('To') ?? '';

  // Look up tenant by the called number
  const tenant = getTenantByPhone(calledNumber);
  const tenantId = tenant?.id ?? 'wolf-law';

  try {
    const agentId = getElevenLabsAgentId(tenantId);
    const twiml = buildVoiceTwiml(agentId, callerNumber);
    console.log(`[voice] Inbound call from ${callerNumber.slice(-4)} → tenant ${tenantId}, agent ${agentId.slice(0, 8)}`);
    sendXml(res, 200, twiml);
  } catch (error) {
    console.error('[voice] Failed to build TwiML:', error);
    const fallback = '<?xml version="1.0" encoding="UTF-8"?><Response><Say>We are unable to connect your call at this time. Please try again later.</Say></Response>';
    sendXml(res, 200, fallback);
  }
}

function handleVoiceStatus(_req: IncomingMessage, res: ServerResponse, rawBody: string): void {
  const params = new URLSearchParams(rawBody);
  const callSid = params.get('CallSid') ?? 'unknown';
  const callStatus = params.get('CallStatus') ?? 'unknown';
  console.log(`[voice] Call status: SID=${callSid} status=${callStatus}`);
  sendJson(res, 200, { received: true });
}

function handleVoicePostCall(_req: IncomingMessage, res: ServerResponse, rawBody: string): void {
  const isJson = rawBody.startsWith('{');
  if (isJson) {
    const data = JSON.parse(rawBody);
    console.log(`[voice] Post-call transcript received: ${data.conversation_id ?? 'unknown'}`);
  } else {
    console.log('[voice] Post-call data received');
  }
  sendJson(res, 200, { received: true });
}

// --- Main request handler ---

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { status: 'ok', mode: 'executive-webhook' });
    return;
  }

  // OAuth routes (GET)
  if (req.method === 'GET' && req.url?.startsWith('/api/oauth/google/authorize')) {
    const urlObj = new URL(req.url, `http://localhost:${PORT}`);
    const identity = urlObj.searchParams.get('user') ?? 'isaiah';
    try {
      const authUrl = getAuthUrl(identity);
      res.writeHead(302, { Location: authUrl });
      res.end();
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : 'OAuth setup failed' });
    }
    return;
  }

  if (req.method === 'GET' && req.url?.startsWith('/api/oauth/google/callback')) {
    const urlObj = new URL(req.url, `http://localhost:${PORT}`);
    const code = urlObj.searchParams.get('code');
    const state = urlObj.searchParams.get('state') ?? 'isaiah';
    if (!code) {
      sendJson(res, 400, { error: 'Missing authorization code' });
      return;
    }
    const result = await handleOAuthCallback(code, state);
    if (result.success) {
      sendJson(res, 200, { status: 'connected', user: state, email: result.email, message: `Google account ${result.email} connected for ${state}` });
    } else {
      sendJson(res, 500, { error: result.error });
    }
    return;
  }

  // Voice routes (POST)
  if (req.method === 'POST') {
    if (req.url?.startsWith('/api/voice/inbound')) {
      const rawBody = await readBody(req);
      handleVoiceInbound(req, res, rawBody);
      return;
    }
    if (req.url?.startsWith('/api/voice/status')) {
      const rawBody = await readBody(req);
      handleVoiceStatus(req, res, rawBody);
      return;
    }
    if (req.url?.startsWith('/api/voice/post-call')) {
      const rawBody = await readBody(req);
      handleVoicePostCall(req, res, rawBody);
      return;
    }
  }

  // Accept POST to /webhook/executive OR /api/executive/inbound (Twilio config)
  const isExecutiveRoute = req.method === 'POST' && (
    req.url?.startsWith('/webhook/executive') ||
    req.url?.startsWith('/api/executive/inbound')
  );
  if (!isExecutiveRoute) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  try {
    const rawBody = await readBody(req);
    const isJson = isJsonRequest(req);
    let message: InboundMessage;

    if (isJson) {
      // Channel 2: iMessage listener (JSON, no Twilio sig)
      message = parseJsonBody(rawBody);
      console.log(`[executive-webhook] iMessage inbound from ${message.from.slice(-4)}`);
    } else {
      // Channel 1: Twilio SMS (form-encoded, validate signature)
      const twilioSignature = req.headers['x-twilio-signature'] as string ?? '';
      const webhookUrl = `${process.env.WEBHOOK_BASE_URL ?? `http://localhost:${PORT}`}${req.url}`;
      const paramsForValidation: Record<string, string> = {};
      new URLSearchParams(rawBody).forEach((v, k) => { paramsForValidation[k] = v; });

      if (!validateTwilioSignature(webhookUrl, paramsForValidation, twilioSignature)) {
        console.error('[executive-webhook] Invalid Twilio signature — rejected');
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      message = parseTwilioForm(rawBody);
      console.log(`[executive-webhook] SMS inbound SID=${message.messageSid}`);
    }

    // Gate: approved numbers only
    if (!isApprovedNumber(message.from)) {
      console.log(`[executive-webhook] Unauthorized number — blocked`);
      if (isJson) {
        sendJson(res, 403, { error: 'unauthorized', reply: '' });
      } else {
        sendTwiml(res);
      }
      return;
    }

    // Check if this is an approval reply (yes/no with optional stamp)
    const approvalResult = await parseApprovalReply(message.body);
    if (approvalResult.handled) {
      const ack = `${approvalResult.decision === 'YES' ? 'Approved' : 'Denied'} ${formatStamp(approvalResult.approvalId)}.`;
      console.log(`[executive-webhook] Approval reply: ${ack}`);
      if (isJson) {
        sendJson(res, 200, { reply: ack });
      } else {
        if (ack) await sendTwilioReply(message.from, ack);
        sendTwiml(res);
      }
      return;
    }

    // Process through executive assistant loop
    const result = await handleExecutiveMessage(message.from, message.body);

    if (result.blocked) {
      if (isJson) {
        sendJson(res, 403, { error: 'blocked', reply: '' });
      } else {
        sendTwiml(res);
      }
      return;
    }

    const reply = result.response || '';

    if (isJson) {
      // iMessage channel: return reply as JSON — listener sends via AppleScript
      sendJson(res, 200, { reply });
    } else {
      // Twilio SMS channel: reply via SMS (same channel in, same channel out)
      if (reply) {
        await sendTwilioReply(message.from, reply);
      }
      sendTwiml(res);
    }
  } catch (error) {
    console.error('[executive-webhook] Error:', error);
    const isJson = isJsonRequest(req);
    if (isJson) {
      sendJson(res, 500, { error: 'internal', reply: '' });
    } else {
      sendTwiml(res, 500);
    }
  }
}

// --- Server lifecycle ---

export function startExecutiveWebhook(): void {
  const server = createServer(handleRequest);

  server.listen(PORT, () => {
    console.log(`[executive-webhook] Listening on port ${PORT}`);
    console.log(`[executive-webhook] Twilio SMS:  POST /webhook/executive (form-encoded)`);
    console.log(`[executive-webhook] iMessage:    POST /webhook/executive (JSON)`);
    console.log(`[executive-webhook] Voice:       POST /api/voice/inbound | /status | /post-call`);
    console.log(`[executive-webhook] OAuth:       GET  /api/oauth/google/authorize?user=isaiah`);
    console.log(`[executive-webhook] Health:      GET  /health`);
  });

  // Clean expired sessions every 5 minutes
  setInterval(runMaintenance, 5 * 60 * 1000);

  process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
  process.on('SIGINT', () => { server.close(() => process.exit(0)); });
}
