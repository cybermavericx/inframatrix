-- InfraMatrix — one-time cleanup after switching to HARD delete.
-- Removes environments orphaned by earlier project deletes, and purges any leftover soft-deleted
-- tombstones (rows with deleted_at set, from the soft-delete era). Safe to re-run.
--   mysql -u <db-user> -p <db-name> < deploy/migrations/2026-06-05-cleanup-orphan-environments.sql

-- 1) Purge soft-deleted projects → FK ON DELETE CASCADE removes their environments + integrations.
DELETE FROM infra_projects WHERE deleted_at IS NOT NULL;

-- 2) Remove environments whose project no longer exists (orphans) → their integrations cascade.
DELETE e FROM infra_environments e
  LEFT JOIN infra_projects p ON p.id = e.project_id
  WHERE p.id IS NULL;

-- 3) Purge any remaining tombstones left from the soft-delete era.
DELETE FROM infra_environments      WHERE deleted_at IS NOT NULL;
DELETE FROM infra_integrations      WHERE deleted_at IS NOT NULL;
DELETE FROM jb_vendors              WHERE deleted_at IS NOT NULL;
DELETE FROM jb_vendor_services      WHERE deleted_at IS NOT NULL;
DELETE FROM jb_vendor_service_clients WHERE deleted_at IS NOT NULL;
DELETE FROM jb_payments             WHERE deleted_at IS NOT NULL;
DELETE FROM jb_clients              WHERE deleted_at IS NOT NULL;
