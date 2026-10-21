import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { IntegrationType } from './integration-type.entity';

@Entity({ name: 'infra_accounts' })
export class Account extends BaseEntity {
  @ManyToOne(() => IntegrationType, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'integration_type_id' })
  integrationType?: IntegrationType | null;

  @Column({ name: 'integration_type_id', type: 'int', nullable: true })
  integrationTypeId?: number | null;

  @Column({ name: 'account_name', length: 190 })
  accountName: string;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ name: 'import_uid', type: 'varchar', length: 64, nullable: true })
  importUid?: string | null;
}
