-- 2026-06-16 — Purge legacy soft-deleted JobBag rows (idempotent).
--
-- WHY: For a window (commit 6af8dff → 98ad5f5) CrudService.remove() soft-deleted entities that
-- had no unique column (Payments, Vendor Services, etc.) — the row stayed in the table with
-- deleted_at set but KEPT its foreign keys. The app now hard-deletes everything (except Users),
-- and the delete pre-checks query only live rows (TypeORM hides deleted_at IS NOT NULL). So a
-- ghost soft-deleted payment is invisible to the pre-check yet its RESTRICT FK still blocks the
-- parent's hard delete → "Internal server error" (500) when deleting a Vendor Service / Vendor /
-- Client. This removes those ghosts so deletes work again.
--
-- SAFE: these rows are already logically deleted — invisible in every list/detail screen, not
-- recoverable through any UI. This does NOT touch core_users (Users are intentionally soft-deleted
-- and must keep their deleted_at rows). Re-running is a no-op.
--
-- Child tables first (so a soft-deleted parent with a soft-deleted child also clears), then parents.

DELETE FROM jb_payments        WHERE deleted_at IS NOT NULL;  -- RESTRICT → vendor_service / vendor / client
DELETE FROM jb_jobs            WHERE deleted_at IS NOT NULL;  -- SET NULL FKs, but vestigial
DELETE FROM jb_reminders       WHERE deleted_at IS NOT NULL;  -- polymorphic, no real FK
DELETE FROM jb_notes           WHERE deleted_at IS NOT NULL;  -- polymorphic, no real FK
DELETE FROM jb_notifications   WHERE deleted_at IS NOT NULL;
DELETE FROM jb_vendor_services WHERE deleted_at IS NOT NULL;  -- RESTRICT → vendor (purge after its payments)
DELETE FROM jb_reminder_groups WHERE deleted_at IS NOT NULL;
DELETE FROM jb_vendors         WHERE deleted_at IS NOT NULL;
DELETE FROM jb_clients         WHERE deleted_at IS NOT NULL;
