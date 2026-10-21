import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { VendorService } from './vendor-service.entity';
import { Vendor } from './vendor.entity';
import { Client } from './client.entity';

/**
 * A payment ("job is the payment"). Two directions:
 *   outgoing — money we pay a vendor (for a vendor service). Primary flow; drives reminders.
 *   incoming — money a client pays us (accounting; optional, not enforced).
 */
@Entity({ name: 'jb_payments' })
export class Payment extends BaseEntity {
  /** outgoing | incoming */
  @Column({ length: 20, default: 'outgoing' })
  direction: string;

  /** what the payment is for (RESTRICT: delete the payments before the service) */
  @ManyToOne(() => VendorService, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vendor_service_id' })
  vendorService?: VendorService | null;

  @Column({ name: 'vendor_service_id', type: 'int', nullable: true })
  vendorServiceId?: number | null;

  /** outgoing → the vendor we pay (RESTRICT: delete the payments before the vendor) */
  @ManyToOne(() => Vendor, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vendor_id' })
  vendor?: Vendor | null;

  @Column({ name: 'vendor_id', type: 'int', nullable: true })
  vendorId?: number | null;

  /** incoming → the client who pays us (RESTRICT: delete the payments before the client) */
  @ManyToOne(() => Client, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'client_id' })
  client?: Client | null;

  @Column({ name: 'client_id', type: 'int', nullable: true })
  clientId?: number | null;

  @Column({ type: 'double', nullable: true })
  amount?: number | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  currency?: string | null;

  /** how it is paid — CARD, CASH, CHEQUE, ONLINE */
  @Column({ name: 'payment_method', type: 'varchar', length: 30, nullable: true })
  paymentMethod?: string | null;

  /** what it covers */
  @Column({ name: 'for_what', type: 'text', nullable: true })
  forWhat?: string | null;

  /** billing period this payment covers */
  @Column({ name: 'period_from', type: 'date', nullable: true })
  periodFrom?: string | null;

  @Column({ name: 'period_to', type: 'date', nullable: true })
  periodTo?: string | null;

  /** when the payment is due (drives reminders) */
  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate?: string | null;

  @Column({ name: 'paid_date', type: 'date', nullable: true })
  paidDate?: string | null;

  /** due, paid, overdue, cancelled */
  @Column({ length: 20, default: 'due' })
  status: string;

  // ── Recurrence (a contract paid in cycles/installments) ──────────────────────
  /** ONE_TIME | WEEKLY | MONTHLY | QUARTERLY | HALF_YEARLY | YEARLY | CUSTOM */
  @Column({ length: 20, default: 'ONE_TIME' })
  frequency: string;

  /** interval in months when frequency = CUSTOM (e.g. 6 = every 6 months) */
  @Column({ name: 'custom_months', type: 'int', nullable: true })
  customMonths?: number | null;

  /** contract end — stop auto-creating the next cycle once nextDue passes this */
  @Column({ name: 'tenure_end', type: 'date', nullable: true })
  tenureEnd?: string | null;

  /** groups all cycles of one recurring obligation */
  @Column({ name: 'series_id', type: 'varchar', length: 64, nullable: true })
  seriesId?: string | null;

  /** guard: a paid cycle spawns its next exactly once */
  @Column({ name: 'spawned_next', type: 'boolean', default: false })
  spawnedNext: boolean;

  @Column({ name: 'import_uid', type: 'varchar', length: 64, nullable: true })
  importUid?: string | null;
}
