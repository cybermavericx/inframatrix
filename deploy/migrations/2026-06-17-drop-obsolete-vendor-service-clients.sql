-- 2026-06-17 — Drop the obsolete jb_vendor_service_clients table (idempotent).
--
-- WHY: The "Service Billing" feature was removed in the JobBag overhaul (2026-06-07); Payment is now
-- the single client↔service↔vendor link. The overhaul migration copied every jb_vendor_service_clients
-- row into jb_payments as an `incoming` payment (idempotent via import_uid = CONCAT('vsc-', vsc.id)) and
-- left the old table in place with a commented-out DROP, to be run "after verifying Payments look right".
--
-- That table is never read by the current code, but it still holds an ON DELETE RESTRICT FK to
-- jb_vendor_services (fk_vsc_service). So any attempt to delete a Vendor Service hits:
--   ER_ROW_IS_REFERENCED_2 (1451): Cannot delete or update a parent row ... jb_vendor_service_clients
-- → "Internal server error" (500). Dropping the dead table removes the blocker.
--
-- SAFE: this re-runs the idempotent backfill FIRST (so any row not yet in Payments is copied over),
-- THEN drops the table. The backfill is guarded so the whole file is re-runnable even after the drop.
-- Keep your Excel/DB backup until you've confirmed Payments look correct.

-- 1. Backfill any not-yet-migrated rows into Payments — only if the old table still exists.
SET @tbl := (SELECT COUNT(*) FROM information_schema.tables
             WHERE table_schema = DATABASE() AND table_name = 'jb_vendor_service_clients');
SET @sql := IF(@tbl > 0,
  "INSERT INTO jb_payments
     (direction, vendor_service_id, client_id, amount, currency, frequency, due_date, status,
      created_at, updated_at, import_uid)
   SELECT 'incoming', vsc.vendor_service_id, vsc.client_id, vsc.amount, vsc.currency,
          COALESCE(NULLIF(vsc.frequency, ''), 'ONE_TIME'), vsc.next_bill_date, 'due',
          vsc.created_at, vsc.updated_at, CONCAT('vsc-', vsc.id)
   FROM jb_vendor_service_clients vsc
   WHERE NOT EXISTS (SELECT 1 FROM jb_payments p WHERE p.import_uid = CONCAT('vsc-', vsc.id))",
  "DO 0");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Drop the obsolete table (removes the fk_vsc_service RESTRICT blocker). Idempotent.
DROP TABLE IF EXISTS jb_vendor_service_clients;
