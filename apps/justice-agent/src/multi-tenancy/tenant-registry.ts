import type { LawFirmTenant } from '@justice/shared-types';

/**
 * Tenant Registry — Multi-tenancy configuration.
 * Each law firm is a tenant with its own phone number, branding, and voice agent.
 * Adding a new tenant = adding an entry here + a Twilio phone number. No code changes.
 */

export const TENANT_REGISTRY: LawFirmTenant[] = [
  {
    id: 'wolf-law',
    name: 'Wolf Law LLC',
    displayName: 'Wolf Law',
    phoneNumber: process.env.WOLF_LAW_PHONE_NUMBER ?? '',
    elevenlabsAgentId: process.env.WOLF_LAW_ELEVENLABS_AGENT_ID ?? '',
    documentPortalUrl: 'https://wolflaw.ai/documents',
    contactEmail: 'justice@wolflaw.ai',
    geography: ['illinois', 'cook_county', 'chicago'],
    practiceAreas: ['retaliation', 'wage_theft', 'discrimination', 'whistleblower'],
    status: 'active',
  },
  // Future tenants added here — no code changes required
];

export function getTenantByPhone(phoneNumber: string): LawFirmTenant | null {
  return TENANT_REGISTRY.find(t => t.phoneNumber === phoneNumber && t.status === 'active') ?? null;
}

export function getTenantById(tenantId: string): LawFirmTenant | null {
  return TENANT_REGISTRY.find(t => t.id === tenantId) ?? null;
}

export function getActiveTenants(): LawFirmTenant[] {
  return TENANT_REGISTRY.filter(t => t.status === 'active');
}
