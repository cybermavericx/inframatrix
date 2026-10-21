import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

/**
 * A reusable label/flag (e.g. "To be dismantled", "Migration scheduled"). The master list — created
 * once, then attached to any number of records via TagAssignment, so the same flag is reused instead
 * of re-typed (no duplicates). `color` drives the chip colour in the UI.
 */
@Entity({ name: 'tags' })
export class Tag extends BaseEntity {
  @Column({ length: 80, unique: true })
  name: string;

  /** chip colour key: gray | green | blue | amber | red (defaults to gray in the UI) */
  @Column({ type: 'varchar', length: 20, nullable: true })
  color?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description?: string | null;

  @Column({ name: 'import_uid', type: 'varchar', length: 64, nullable: true })
  importUid?: string | null;
}
