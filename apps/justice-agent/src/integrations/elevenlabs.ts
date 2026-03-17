/**
 * ElevenLabs voice agent integration.
 * Each tenant has its own ElevenLabs agent ID for branded voice experience.
 */

import { getTenantById } from '../multi-tenancy/tenant-registry';

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';

export interface ElevenLabsConfig {
  agentId: string;
  apiKey: string;
}

export function getElevenLabsConfig(agentId: string): ElevenLabsConfig {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');
  return { agentId, apiKey };
}

/**
 * Get the ElevenLabs agent ID for a given tenant.
 * Falls back to ELEVENLABS_AGENT_ID env var if tenant has none configured.
 */
export function getElevenLabsAgentId(tenantId: string): string {
  const tenant = getTenantById(tenantId);
  const agentId = tenant?.elevenlabsAgentId || process.env.ELEVENLABS_AGENT_ID;
  if (!agentId) throw new Error(`No ElevenLabs agent ID for tenant ${tenantId}`);
  return agentId;
}

/**
 * Build TwiML XML that connects a Twilio call to an ElevenLabs WebSocket agent.
 */
export function buildVoiceTwiml(agentId: string, callerNumber: string): string {
  const wsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${agentId}`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    '  <Connect>',
    `    <Stream url="${escapeXml(wsUrl)}">`,
    `      <Parameter name="caller_number" value="${escapeXml(callerNumber)}" />`,
    '    </Stream>',
    '  </Connect>',
    '</Response>',
  ].join('\n');
}

export async function updateAgentPrompt(
  agentId: string,
  systemPrompt: string
): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { success: false, error: 'ELEVENLABS_API_KEY not set' };

  try {
    const response = await fetch(`${ELEVENLABS_BASE_URL}/convai/agents/${agentId}`, {
      method: 'PATCH',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversation_config: {
          agent: { prompt: { prompt: systemPrompt } },
        },
      }),
    });

    if (!response.ok) {
      return { success: false, error: `ElevenLabs API error: ${response.status}` };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
