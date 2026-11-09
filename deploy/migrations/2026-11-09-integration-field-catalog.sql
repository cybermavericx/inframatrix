-- Technology catalog for custom_fields integration types (phase 3).
-- ADDITIVE ONLY: two new tables. No existing column or row is changed; fieldValues JSON stays the
-- source of truth and keeps being written (dual-write), so reverting the code loses nothing.
--   infra_integration_field_options : one row per fixed-list option, with status current|outdated|eol
--   infra_integration_field_values  : one row per (integration, field key) — the searchable copy
-- REQUIRED before the new code runs. Safe to re-run (IF NOT EXISTS).
-- After it: node dist/database/backfill-field-values.js --dry-run, then without --dry-run.
-- Undo: deploy/rollback/2026-11-09-integration-field-catalog.rollback.sql (after reverting the code).
-- Names match the TypeORM entities exactly, so the production seed's synchronize sees nothing to change.

CREATE TABLE IF NOT EXISTS infra_integration_field_options (
  id                  INT NOT NULL AUTO_INCREMENT,
  created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  integration_type_id INT NOT NULL,
  field_key           VARCHAR(190) NOT NULL,
  value               VARCHAR(255) NOT NULL,
  sort_key            VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status              VARCHAR(10) NOT NULL DEFAULT 'current',
  position            INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_field_options_type_key_value (integration_type_id, field_key, value),
  CONSTRAINT fk_field_options_type FOREIGN KEY (integration_type_id) REFERENCES infra_integration_types (id) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS infra_integration_field_values (
  id             INT NOT NULL AUTO_INCREMENT,
  integration_id INT NOT NULL,
  field_key      VARCHAR(190) NOT NULL,
  value          VARCHAR(1000) NOT NULL,
  sort_key       VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  version_level  VARCHAR(5) NULL,
  option_id      INT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_field_values_integration_key (integration_id, field_key),
  KEY idx_field_values_key_sort (field_key, sort_key),
  KEY idx_field_values_option (option_id),
  CONSTRAINT fk_field_values_integration FOREIGN KEY (integration_id) REFERENCES infra_integrations (id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT fk_field_values_option FOREIGN KEY (option_id) REFERENCES infra_integration_field_options (id) ON DELETE RESTRICT ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
