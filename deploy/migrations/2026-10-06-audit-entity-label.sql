-- Change-log upgrade (Activity Log screens): store each record's readable name on its log rows, so the
-- system-wide Activity Log can say "bespokeliving.com · live" even after that record is deleted, and
-- flag rows that are copies written onto a parent's timeline (so the global log doesn't list them twice).
-- Additive; existing rows keep NULL / 0 (older history shows "<type> #<id>").
-- REQUIRED before the new code runs: without these columns the change-log can't be read or written.
ALTER TABLE audit_log ADD COLUMN entity_label VARCHAR(255) NULL;
ALTER TABLE audit_log ADD COLUMN mirror TINYINT(1) NOT NULL DEFAULT 0;
-- speeds up the system-wide log (newest first, filtered by date/type)
CREATE INDEX idx_audit_log_created ON audit_log (created_at);
