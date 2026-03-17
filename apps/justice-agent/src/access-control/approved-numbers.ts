/**
 * Access control for Mode 1 (Executive Assistant).
 * Only Isaiah and Scott are authorized to use executive mode.
 * All other callers are routed to voice agent (Mode 2).
 */

const APPROVED_NUMBERS: string[] = [
  process.env.APPROVED_NUMBER_ISAIAH,
  process.env.APPROVED_NUMBER_SCOTT,
].filter((n): n is string => Boolean(n));

export function isApprovedNumber(phoneNumber: string): boolean {
  const normalized = normalizePhone(phoneNumber);
  return APPROVED_NUMBERS.some(n => normalizePhone(n) === normalized);
}

export function getCallerIdentity(phoneNumber: string): 'isaiah' | 'scott' | null {
  const normalized = normalizePhone(phoneNumber);
  if (process.env.APPROVED_NUMBER_ISAIAH && normalizePhone(process.env.APPROVED_NUMBER_ISAIAH) === normalized) {
    return 'isaiah';
  }
  if (process.env.APPROVED_NUMBER_SCOTT && normalizePhone(process.env.APPROVED_NUMBER_SCOTT) === normalized) {
    return 'scott';
  }
  return null;
}

function normalizePhone(phone: string): string {
  // Strip to digits only, ensure +1 prefix
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}
