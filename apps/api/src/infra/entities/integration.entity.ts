import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { Environment } from './environment.entity';
import { IntegrationType } from './integration-type.entity';
import { Account } from './account.entity';

@Entity({ name: 'infra_integrations' })
export class Integration extends BaseEntity {
  @ManyToOne(() => Environment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'environment_id' })
  environment?: Environment | null;

  @Column({ name: 'environment_id', type: 'int', nullable: true })
  environmentId?: number | null;

  @ManyToOne(() => IntegrationType, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'integration_type_id' })
  integrationType?: IntegrationType | null;

  @Column({ name: 'integration_type_id', type: 'int', nullable: true })
  integrationTypeId?: number | null;

  @ManyToOne(() => Account, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'account_id' })
  account?: Account | null;

  @Column({ name: 'account_id', type: 'int', nullable: true })
  accountId?: number | null;

  /** key name for key_value integration types (e.g. "server location") */
  @Column({ name: 'key_name', type: 'varchar', length: 190, nullable: true })
  keyName?: string | null;

  /** safe identifier / config id (never raw secrets) */
  @Column({ type: 'varchar', length: 255, nullable: true })
  value?: string | null;

  /** values for behavior = 'custom_fields', keyed by IntegrationTypeField.key (never passwords/secrets) */
  @Column({ name: 'field_values', type: 'json', nullable: true })
  fieldValues?: Record<string, string> | null;

  @Column({ name: 'import_uid', type: 'varchar', length: 64, nullable: true })
  importUid?: string | null;
}
