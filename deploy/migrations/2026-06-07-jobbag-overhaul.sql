-- JobBag overhaul (2026-06-07). Additive schema + a one-time data move. Apply ONCE on the server.
-- MySQL has no "ADD COLUMN IF NOT EXISTS", so a statement errors harmlessly if already applied —
-- run the file once and ignore "duplicate column/table" errors on re-runs.
--
-- After this SQL, register the two new RBAC resources (jobbag.notes, jobbag.outbox) by running the
-- seed in production mode (additive — it does NOT drop data when NODE_ENV=production):
--     cd apps/api && NODE_ENV=production node dist/database/seed.js
-- (Details in DEPLOY.md.)

-- ── 1. Reminders: new lifecycle + polymorphic parent + resolve fields ──────────────────────────
ALTER TABLE jb_reminders ADD COLUMN title        VARCHAR(200) NULL AFTER parent_id;
ALTER TABLE jb_reminders ADD COLUMN series_id    VARCHAR(64)  NULL;
ALTER TABLE jb_reminders ADD COLUMN fired_at     DATETIME     NULL;
ALTER TABLE jb_reminders ADD COLUMN resolved_note TEXT        NULL;
ALTER TABLE jb_reminders ADD COLUMN resolved_at  DATETIME     NULL;
ALTER TABLE jb_reminders ADD COLUMN resolved_by  INT          NULL;

-- Map the old status values to the new lifecycle (WAITING/DUE/PENDING_RESOLVED/RESOLVED/CANCELLED).
UPDATE jb_reminders SET status = 'WAITING'   WHERE status IN ('SCHEDULED', 'FAILED');
UPDATE jb_reminders SET status = 'RESOLVED'  WHERE status = 'SENT';
UPDATE jb_reminders SET status = 'CANCELLED' WHERE status = 'CANCELED';

-- ── 2. Jobs: link a vendor-service (vendor shown via it) + a client + an action note ───────────
ALTER TABLE jb_jobs ADD COLUMN vendor_service_id INT  NULL;
ALTER TABLE jb_jobs ADD COLUMN client_id         INT  NULL;
ALTER TABLE jb_jobs ADD COLUMN action            TEXT NULL;
ALTER TABLE jb_jobs ADD CONSTRAINT fk_job_service FOREIGN KEY (vendor_service_id) REFERENCES jb_vendor_services(id) ON DELETE SET NULL;
ALTER TABLE jb_jobs ADD CONSTRAINT fk_job_client  FOREIGN KEY (client_id)         REFERENCES jb_clients(id)         ON DELETE SET NULL;

-- ── 3. Notes: a polymorphic note attachable to any record ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS jb_notes (
  id INT NOT NULL AUTO_INCREMENT,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL,
  created_by INT NULL, updated_by INT NULL,
  parent_type VARCHAR(30) NULL, parent_id INT NULL,
  body TEXT NULL, author_name VARCHAR(190) NULL, import_uid VARCHAR(64) NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 4. Outbox: every mail the system sends / stores (fallback + audit) ──────────────────────────
CREATE TABLE IF NOT EXISTS jb_outbox (
  id INT NOT NULL AUTO_INCREMENT,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL,
  created_by INT NULL, updated_by INT NULL,
  to_addr TEXT NULL, subject VARCHAR(255) NULL, body LONGTEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'QUEUED', provider VARCHAR(20) NULL, error TEXT NULL,
  sent_at DATETIME NULL, related_type VARCHAR(30) NULL, related_id INT NULL, import_uid VARCHAR(64) NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 5. Service Billing → Payments (incoming). The Payment record is now the single client↔service↔
--       vendor link, so each billing row becomes an incoming payment. Idempotent via import_uid. ──
INSERT INTO jb_payments
  (direction, vendor_service_id, client_id, amount, currency, frequency, due_date, status,
   created_at, updated_at, import_uid)
SELECT 'incoming', vsc.vendor_service_id, vsc.client_id, vsc.amount, vsc.currency,
       COALESCE(NULLIF(vsc.frequency, ''), 'ONE_TIME'), vsc.next_bill_date, 'due',
       vsc.created_at, vsc.updated_at, CONCAT('vsc-', vsc.id)
FROM jb_vendor_service_clients vsc
WHERE NOT EXISTS (SELECT 1 FROM jb_payments p WHERE p.import_uid = CONCAT('vsc-', vsc.id));

-- After verifying the payments look right, drop the old table (irreversible — keep your Excel backup):
-- DROP TABLE jb_vendor_service_clients;
