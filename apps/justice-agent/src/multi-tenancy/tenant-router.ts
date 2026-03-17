import type { LawFirmTenant } from '@justice/shared-types';
import { getTenantByPhone } from './tenant-registry';
import { isApprovedNumber } from '../access-control/approved-numbers';

export type RouteDecision =
  | { mode: 'executive'; tenant: null }
  | { mode: 'voice-agent'; tenant: LawFirmTenant }
  | { mode: 'unknown'; tenant: null };

/**
 * Route an inbound Twilio call/message to the correct mode.
 *
 * Decision logic:
 * 1. If caller is an approved number (Isaiah/Scott) -> Mode 1 (executive)
 * 2. If the TO number matches a tenant -> Mode 2 (voice agent for that tenant)
 * 3. Otherwise -> unknown (reject or log)
 */
export function routeInbound(fromNumber: string, toNumber: string): RouteDecision {
  // Mode 1: Executive assistant (approved numbers only)
  if (isApprovedNumber(fromNumber)) {
    return { mode: 'executive', tenant: null };
  }

  // Mode 2: Voice agent (route by tenant phone number)
  const tenant = getTenantByPhone(toNumber);
  if (tenant) {
    return { mode: 'voice-agent', tenant };
  }

  // Unknown — no matching tenant for this phone number
  return { mode: 'unknown', tenant: null };
}

/**
 * Route an inbound call and return mode + tenantId.
 * Convenience wrapper for voice webhook routing.
 */
export function routeInboundCall(
  calledNumber: string,
  callerNumber: string
): { mode: 'executive' | 'voice-agent' | 'unknown'; tenantId: string | null } {
  const decision = routeInbound(callerNumber, calledNumber);
  return {
    mode: decision.mode,
    tenantId: decision.mode === 'voice-agent' ? decision.tenant!.id : null,
  };
}
