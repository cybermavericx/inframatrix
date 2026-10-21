-- TOTP two-factor auth. mfa_secret_encrypted holds the AES-256-GCM-encrypted TOTP secret (see
-- apps/api/src/auth/mfa-crypto.util.ts) -- one column serves both "pending setup" and "confirmed"
-- states; mfa_enabled only flips true once the user proves a valid code. Not idempotent (plain MySQL
-- has no ADD COLUMN IF NOT EXISTS) -- run once, same as the other ALTER-based migrations here.

ALTER TABLE users ADD COLUMN mfa_enabled TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN mfa_secret_encrypted VARCHAR(255) NULL;
