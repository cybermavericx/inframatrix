-- Service Billing gets a period: how often the amount is billed, and the next bill date
-- (so "250" means "250 per <frequency>, next due <next_bill_date>"). Both additive + nullable.
-- MySQL has no "ADD COLUMN IF NOT EXISTS"; these error harmlessly if already applied.

ALTER TABLE jb_vendor_service_clients ADD COLUMN frequency VARCHAR(40) NULL;
ALTER TABLE jb_vendor_service_clients ADD COLUMN next_bill_date DATE NULL;
