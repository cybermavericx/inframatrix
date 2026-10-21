-- Reusable tags/flags (attachable to any record, with soft-detach history) + a polymorphic change-log
-- ("chatter") that records create/update/delete with old→new values and who made the change.
-- All additive and idempotent (CREATE TABLE IF NOT EXISTS); safe to re-run.
-- After applying, run the prod seed once to create the `infra.tags` RBAC groups:
--   NODE_ENV=production node dist/database/seed.js

-- Reusable tag master list (one row per distinct flag; reused instead of duplicated).
CREATE TABLE IF NOT EXISTS tags (
  id INT NOT NULL AUTO_INCREMENT,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL,
  created_by INT NULL,
  updated_by INT NULL,
  name VARCHAR(80) NOT NULL,
  color VARCHAR(20) NULL,
  description VARCHAR(255) NULL,
  import_uid VARCHAR(64) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_tag_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A tag attached to a record (polymorphic). removed_at = soft-detach (kept for history).
CREATE TABLE IF NOT EXISTS tag_assignments (
  id INT NOT NULL AUTO_INCREMENT,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL,
  created_by INT NULL,
  updated_by INT NULL,
  tag_id INT NOT NULL,
  parent_type VARCHAR(30) NOT NULL,
  parent_id INT NOT NULL,
  removed_at DATETIME NULL,
  removed_by INT NULL,
  import_uid VARCHAR(64) NULL,
  PRIMARY KEY (id),
  KEY idx_tag_assign_parent (parent_type, parent_id),
  KEY idx_tag_assign_tag (tag_id),
  CONSTRAINT fk_tag_assign_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only change-log / chatter timeline for any record.
CREATE TABLE IF NOT EXISTS audit_log (
  id INT NOT NULL AUTO_INCREMENT,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  entity_type VARCHAR(40) NOT NULL,
  entity_id INT NOT NULL,
  action VARCHAR(12) NOT NULL,
  field VARCHAR(80) NULL,
  field_label VARCHAR(140) NULL,
  old_value TEXT NULL,
  new_value TEXT NULL,
  message VARCHAR(255) NULL,
  author_id INT NULL,
  author_name VARCHAR(190) NULL,
  PRIMARY KEY (id),
  KEY idx_audit_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
