-- Reminders are now created against a Payment / Service-Billing record and target chosen recipients
-- (users and/or reminder distribution-groups). Adds the linkage + recipient columns, and the new
-- jb_reminder_groups distribution-list table. All additive; errors harmlessly if already applied.

ALTER TABLE jb_reminders ADD COLUMN parent_type VARCHAR(30) NULL;
ALTER TABLE jb_reminders ADD COLUMN parent_id INT NULL;
ALTER TABLE jb_reminders ADD COLUMN recipient_user_ids TEXT NULL;
ALTER TABLE jb_reminders ADD COLUMN recipient_group_ids TEXT NULL;

CREATE TABLE IF NOT EXISTS jb_reminder_groups (
  id INT NOT NULL AUTO_INCREMENT,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  deleted_at DATETIME(6) NULL,
  created_by INT NULL,
  updated_by INT NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT NULL,
  member_user_ids TEXT NULL,
  import_uid VARCHAR(64) NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
