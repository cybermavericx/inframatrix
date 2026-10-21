import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

/** One custom field on a `custom_fields`-behavior Integration Type (e.g. CMS Access's "Login URL"). */
export interface IntegrationTypeField {
  key: string;
  label: string;
  /** closed set of expected/suggested answers — flagged if the entered value matches none (exact, case-insensitive). Empty = no check. */
  possibleValues: string[];
  /** known-bad patterns — flagged if the entered value contains one (substring, case-insensitive). Empty = no check. */
  avoidableValues: string[];
  /** which list the editor shows for this field — a field is either a mandatory closed list ('possible')
   *  or an open denylist ('avoidable'), never both. Purely an authoring-UI concern; validation itself
   *  just checks whichever list is populated. */
  mode?: 'possible' | 'avoidable';
}

@Entity({ name: 'infra_integration_types' })
export class IntegrationType extends BaseEntity {
  /** SendGrid, reCAPTCHA, Cloudflare, Akamai ... */
  @Column({ length: 120, unique: true })
  name: string;

  /** generic_value | key_value | account_select_optional | custom_fields */
  @Column({ length: 40, default: 'generic_value' })
  behavior: string;

  /** field defs for behavior = 'custom_fields' (see IntegrationTypeField). Never store password/secret fields here. */
  @Column({ type: 'json', nullable: true })
  fields?: IntegrationTypeField[] | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'import_uid', type: 'varchar', length: 64, nullable: true })
  importUid?: string | null;
}
