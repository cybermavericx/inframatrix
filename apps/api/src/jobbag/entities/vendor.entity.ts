import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { Payment } from './payment.entity';
import { VendorService } from './vendor-service.entity';

@Entity({ name: 'jb_vendors' })
export class Vendor extends BaseEntity {
  /** Reverse sides — read-only, for the export field picker's drill-down. */
  @OneToMany(() => Payment, (p) => p.vendor)
  payments?: Payment[];

  @OneToMany(() => VendorService, (s) => s.vendor)
  services?: VendorService[];

  @Column({ name: 'vendor_name', length: 190 })
  vendorName: string;

  @Column({ name: 'poc_name', type: 'varchar', length: 190, nullable: true })
  pocName?: string | null;

  @Column({ name: 'poc_email', type: 'varchar', length: 190, nullable: true })
  pocEmail?: string | null;

  @Column({ name: 'poc_phone', type: 'varchar', length: 50, nullable: true })
  pocPhone?: string | null;

  /** CARD, CASH, CHEQUE, ONLINE */
  @Column({ name: 'payment_method', type: 'varchar', length: 30, nullable: true })
  paymentMethod?: string | null;

  @Column({ name: 'billing_under', type: 'varchar', length: 100, nullable: true })
  billingUnder?: string | null;

  @Column({ type: 'text', nullable: true })
  address?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  trn?: string | null;

  /** free-text description of what the vendor provides (optional) */
  @Column({ type: 'text', nullable: true })
  description?: string | null;

  /** active, inactive */
  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: string;

  @Column({ name: 'import_uid', type: 'varchar', length: 64, nullable: true })
  importUid?: string | null;
}
