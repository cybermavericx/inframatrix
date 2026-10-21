-- JobBag referential integrity: all downward foreign keys use ON DELETE RESTRICT, so a parent
-- cannot be deleted while child records still point at it. The app layer mirrors this and returns a
-- 409 listing the exact blocking records (with their ids) so the user can open and delete them first.
--
--   jb_vendor_services.vendor_id          -> jb_vendors(id)          RESTRICT
--   jb_payments.vendor_service_id         -> jb_vendor_services(id)  RESTRICT
--   jb_payments.vendor_id                 -> jb_vendors(id)          RESTRICT
--   jb_payments.client_id                 -> jb_clients(id)          RESTRICT
--   jb_vendor_service_clients.vendor_service_id -> jb_vendor_services(id) RESTRICT
--   jb_vendor_service_clients.client_id   -> jb_clients(id)          RESTRICT
--
-- Safe to re-run: for each column it looks up whatever FK currently exists, drops it, then re-adds a
-- deterministically-named RESTRICT constraint. (Supersedes the earlier *-fk-cascade.sql.)

SET @db := DATABASE();

-- 1) jb_vendor_services.vendor_id -> jb_vendors
SET @fk := (SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='jb_vendor_services' AND COLUMN_NAME='vendor_id' AND REFERENCED_TABLE_NAME IS NOT NULL LIMIT 1);
SET @sql := IF(@fk IS NOT NULL, CONCAT('ALTER TABLE jb_vendor_services DROP FOREIGN KEY `', @fk, '`'), 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
ALTER TABLE jb_vendor_services
  ADD CONSTRAINT fk_vs_vendor FOREIGN KEY (vendor_id) REFERENCES jb_vendors(id) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- 2) jb_payments.vendor_service_id -> jb_vendor_services
SET @fk := (SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='jb_payments' AND COLUMN_NAME='vendor_service_id' AND REFERENCED_TABLE_NAME IS NOT NULL LIMIT 1);
SET @sql := IF(@fk IS NOT NULL, CONCAT('ALTER TABLE jb_payments DROP FOREIGN KEY `', @fk, '`'), 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
ALTER TABLE jb_payments
  ADD CONSTRAINT fk_pay_vendor_service FOREIGN KEY (vendor_service_id) REFERENCES jb_vendor_services(id) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- 3) jb_payments.vendor_id -> jb_vendors
SET @fk := (SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='jb_payments' AND COLUMN_NAME='vendor_id' AND REFERENCED_TABLE_NAME IS NOT NULL LIMIT 1);
SET @sql := IF(@fk IS NOT NULL, CONCAT('ALTER TABLE jb_payments DROP FOREIGN KEY `', @fk, '`'), 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
ALTER TABLE jb_payments
  ADD CONSTRAINT fk_pay_vendor FOREIGN KEY (vendor_id) REFERENCES jb_vendors(id) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- 4) jb_payments.client_id -> jb_clients
SET @fk := (SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='jb_payments' AND COLUMN_NAME='client_id' AND REFERENCED_TABLE_NAME IS NOT NULL LIMIT 1);
SET @sql := IF(@fk IS NOT NULL, CONCAT('ALTER TABLE jb_payments DROP FOREIGN KEY `', @fk, '`'), 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
ALTER TABLE jb_payments
  ADD CONSTRAINT fk_pay_client FOREIGN KEY (client_id) REFERENCES jb_clients(id) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- 5) jb_vendor_service_clients.vendor_service_id -> jb_vendor_services
SET @fk := (SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='jb_vendor_service_clients' AND COLUMN_NAME='vendor_service_id' AND REFERENCED_TABLE_NAME IS NOT NULL LIMIT 1);
SET @sql := IF(@fk IS NOT NULL, CONCAT('ALTER TABLE jb_vendor_service_clients DROP FOREIGN KEY `', @fk, '`'), 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
ALTER TABLE jb_vendor_service_clients
  ADD CONSTRAINT fk_vsc_service FOREIGN KEY (vendor_service_id) REFERENCES jb_vendor_services(id) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- 6) jb_vendor_service_clients.client_id -> jb_clients
SET @fk := (SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA=@db AND TABLE_NAME='jb_vendor_service_clients' AND COLUMN_NAME='client_id' AND REFERENCED_TABLE_NAME IS NOT NULL LIMIT 1);
SET @sql := IF(@fk IS NOT NULL, CONCAT('ALTER TABLE jb_vendor_service_clients DROP FOREIGN KEY `', @fk, '`'), 'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
ALTER TABLE jb_vendor_service_clients
  ADD CONSTRAINT fk_vsc_client FOREIGN KEY (client_id) REFERENCES jb_clients(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
