-- InfraMatrix — add recurrence columns to jb_payments (additive, no data loss).
-- Run ONCE against the app database after deploying the recurrence feature:
--   mysql -u <db-user> -p <db-name> < deploy/migrations/2026-06-05-payment-recurrence.sql
-- (MySQL has no "ADD COLUMN IF NOT EXISTS" — if a column already exists it errors; that's fine.)

ALTER TABLE jb_payments
  ADD COLUMN frequency     VARCHAR(20) NOT NULL DEFAULT 'ONE_TIME',
  ADD COLUMN custom_months INT         NULL,
  ADD COLUMN tenure_end    DATE        NULL,
  ADD COLUMN series_id     VARCHAR(64) NULL,
  ADD COLUMN spawned_next  TINYINT(1)  NOT NULL DEFAULT 0;
