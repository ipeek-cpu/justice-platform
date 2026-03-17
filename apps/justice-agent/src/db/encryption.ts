/**
 * PII Encryption — Tier 3 data protection.
 *
 * Uses AES-256-GCM with per-record random IVs.
 * Format: iv:authTag:ciphertext (all hex-encoded)
 * Key sourced from PII_ENCRYPTION_KEY env var (64-char hex = 32 bytes).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

function getKey(): Buffer {
  const keyHex = process.env.PII_ENCRYPTION_KEY;
  if (!keyHex) throw new Error('PII_ENCRYPTION_KEY not set');
  if (keyHex.length !== 64) throw new Error('PII_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  return Buffer.from(keyHex, 'hex');
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decrypt(encrypted: string): string {
  const parts = encrypted.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format — expected iv:authTag:ciphertext');

  const [ivHex, authTagHex, ciphertext] = parts;
  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
