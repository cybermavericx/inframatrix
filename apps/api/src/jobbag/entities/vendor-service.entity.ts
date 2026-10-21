import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { Vendor } from './vendor.entity';
import { Payment } from './payment.entity';

@Entity({ name: 'jb_vendor_services' })
export class VendorService extends BaseEntity {
  /** Reverse side of Payment.vendorService — read-only, for the export field picker's drill-down. */
  @OneToMany(() => Payment, (p) => p.vendorService)
  payments?: Payment[];

  /** link to the vendor we buy this service from (RESTRICT: delete the services before the vendor) */
  @ManyToOne(() => Vendor, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vendor_id' })
  vendor?: Vendor | null;

  @Column({ name: 'vendor_id', type: 'int', nullable: true })
  vendorId?: number | null;

  @Column({ name: 'service_name', type: 'varchar', length: 190, nullable: true })
  serviceName?: string | null;

  @Column({ type: 'double', nullable: true })
  cost?: number | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  currency?: string | null;

  @Column({ type: 'int', nullable: true })
  quantity?: number | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  frequency?: string | null;

  /** how it is paid — CARD, CASH, CHEQUE, ONLINE */
  @Column({ name: 'payment_method', type: 'varchar', length: 30, nullable: true })
  paymentMethod?: string | null;

  @Column({ name: 'start_date', type: 'date', nullable: true })
  startDate?: string | null;

  @Column({ name: 'expiry_date', type: 'date', nullable: true })
  expiryDate?: string | null;

  /** Y / N */
  @Column({ name: 'is_renewable', length: 1, default: 'N' })
  isRenewable: string;

  /** MONTHLY, SIX_MONTHS, ONE_YEAR, TWO_YEARS, MORE_THAN_TWO_YEARS */
  @Column({ name: 'renewable_type', type: 'varchar', length: 30, nullable: true })
  renewableType?: string | null;

  /** CREATED, STARTED, EXPIRED, DROPPED */
  @Column({ length: 30, default: 'CREATED' })
  status: string;

  @Column({ name: 'import_uid', type: 'varchar', length: 64, nullable: true })
  importUid?: string | null;
}
