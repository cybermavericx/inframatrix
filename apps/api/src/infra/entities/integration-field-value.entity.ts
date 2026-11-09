import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Integration } from './integration.entity';
import { IntegrationFieldOption } from './integration-field-option.entity';

/**
 * One custom-field value of one integration, as a row: the searchable copy of
 * Integration.fieldValues[fieldKey]. DUAL-WRITE: the JSON column is still written on every save and
 * stays the source of truth, so reverting the code loses nothing; this table is rebuilt from it by
 * field-catalog.ts (on save) and by the backfill (dist/database/backfill-field-values.js).
 * Only keys defined on the integration's type are copied. Never holds passwords (the type guard
 * already forbids such fields).
 */
@Entity({ name: 'infra_integration_field_values' })
@Unique('uq_field_values_integration_key', ['integrationId', 'fieldKey'])
@Index('idx_field_values_key_sort', ['fieldKey', 'sortKey'])
@Index('idx_field_values_option', ['optionId'])
export class IntegrationFieldValue {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Integration, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'integration_id', foreignKeyConstraintName: 'fk_field_values_integration' })
  integration?: Integration;

  @Column({ name: 'integration_id', type: 'int' })
  integrationId: number;

  @Column({ name: 'field_key', type: 'varchar', length: 190 })
  fieldKey: string;

  @Column({ type: 'varchar', length: 1000 })
  value: string;

  /** versionKey(value).key for version-kind fields (null if not a version or a text field). */
  @Column({ name: 'sort_key', type: 'varchar', length: 64, nullable: true, charset: 'ascii', collation: 'ascii_bin' })
  sortKey?: string | null;

  /** 'line' (patch unknown, e.g. "8.3" / "10.x") or 'exact' (e.g. "8.3.35"); null when sortKey is null. */
  @Column({ name: 'version_level', type: 'varchar', length: 5, nullable: true })
  versionLevel?: 'line' | 'exact' | null;

  /** The fixed-list option this value matches (case-insensitive), if any. RESTRICT: an option in use
   *  can't be deleted — the API checks first and answers 409; this is the backstop. */
  @ManyToOne(() => IntegrationFieldOption, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'option_id', foreignKeyConstraintName: 'fk_field_values_option' })
  option?: IntegrationFieldOption | null;

  @Column({ name: 'option_id', type: 'int', nullable: true })
  optionId?: number | null;
}
