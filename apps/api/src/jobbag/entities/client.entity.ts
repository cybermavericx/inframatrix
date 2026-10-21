import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { Payment } from './payment.entity';

@Entity({ name: 'jb_clients' })
export class Client extends BaseEntity {
  /** Reverse side of Payment.client — read-only, for the export field picker's drill-down. */
  @OneToMany(() => Payment, (p) => p.client)
  payments?: Payment[];

  @Column({ length: 190 })
  name: string;

  @Column({ name: 'group_name', type: 'varchar', length: 190, nullable: true })
  groupName?: string | null;

  @Column({ type: 'varchar', length: 190, nullable: true })
  email?: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phone?: string | null;

  @Column({ name: 'billing_under', type: 'varchar', length: 100, nullable: true })
  billingUnder?: string | null;

  @Column({ name: 'billing_address', type: 'text', nullable: true })
  billingAddress?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  trn?: string | null;

  /** active, inactive */
  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: string;

  @Column({ name: 'import_uid', type: 'varchar', length: 64, nullable: true })
  importUid?: string | null;
}
