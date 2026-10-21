import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

/**
 * AES-256-GCM at rest for TOTP secrets. Unlike passwords these can't be one-way hashed — verifying a
 * code needs the original secret back — so encryption (not hashing) is the right tool. Key comes from
 * MFA_ENCRYPTION_KEY (32-byte hex); falls back to a fixed dev value like the JWT secrets do, but a
 * real key must be set in production (see DEPLOY.md).
 */
const KEY = (() => {
  const hex = process.env.MFA_ENCRYPTION_KEY;
  if (hex) return Buffer.from(hex, 'hex');
  // dev-only fallback — deterministic, not secret-strength, never used if MFA_ENCRYPTION_KEY is set
  return scryptSync('change_me_mfa_encryption_key', 'inframatrix-mfa', 32);
})();

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), ciphertext.toString('hex')].join(':');
}

export function decryptSecret(stored: string): string {
  const [ivHex, tagHex, dataHex] = stored.split(':');
  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}
