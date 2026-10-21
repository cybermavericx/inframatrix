-- Enforced-MFA policy on top of the self-service MFA from 2026-09-10-mfa.sql: mfa_required marks an
-- account as subject to the policy; mfa_required_by is the deadline (set once, when the requirement
-- is first turned on -- not idempotent, run once, same as the other ALTER-based migrations here).

ALTER TABLE users ADD COLUMN mfa_required TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN mfa_required_by DATETIME NULL;

-- Roll the policy out to every current user who doesn't already have MFA on -- 15 days from
-- whenever this migration runs. Users who already enabled it voluntarily are left alone.
UPDATE users SET mfa_required = 1, mfa_required_by = DATE_ADD(NOW(), INTERVAL 15 DAY) WHERE mfa_enabled = 0;
