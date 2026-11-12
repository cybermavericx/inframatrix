import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { IntegrationType } from './integration-type.entity';

/** How current an option is. Admin-set; drives `hasOutdatedTechnology` and the per-field status. */
export const OPTION_STATUSES = ['current', 'outdated', 'eol'] as const;
export type OptionStatus = (typeof OPTION_STATUSES)[number];

/**
 * One entry of a custom field's fixed list (IntegrationTypeField.possibleValues), mirrored into a row so
 * it can carry a status and a usage count. The JSON list stays the source of WHICH values exist (old code
 * keeps reading it); this table adds the status. Kept in sync by field-catalog.ts on every type save.
 * Created by deploy/migrations/2026-11-09-integration-field-catalog.sql — names here match it exactly.
 */
@Entity({ name: 'infra_integration_field_options' })
@Unique('uq_field_options_type_key_value', ['integrationTypeId', 'fieldKey', 'value'])
export class IntegrationFieldOption {
  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => IntegrationType, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'integration_type_id', foreignKeyConstraintName: 'fk_field_options_type' })
  integrationType?: IntegrationType;

  @Column({ name: 'integration_type_id', type: 'int' })
  integrationTypeId: number;

  @Column({ name: 'field_key', type: 'varchar', length: 190 })
  fieldKey: string;

  @Column({ type: 'varchar', length: 255 })
  value: string;

  /** versionKey(value).key for version-kind fields, else null. ascii_bin so it compares byte by byte. */
  @Column({ name: 'sort_key', type: 'varchar', length: 64, nullable: true, charset: 'ascii', collation: 'ascii_bin' })
  sortKey?: string | null;

  @Column({ type: 'varchar', length: 10, default: 'current' })
  status: OptionStatus;

  @Column({ type: 'int', default: 0 })
  position: number;
}
