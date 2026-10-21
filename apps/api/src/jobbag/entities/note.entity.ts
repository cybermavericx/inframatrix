import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

/**
 * A polymorphic note that can be attached to ANY record (the generic "+ Add note" flow).
 * `parentType`/`parentId` reference the owning record (e.g. 'payment', 'vendor_service', 'client').
 */
@Entity({ name: 'jb_notes' })
export class Note extends BaseEntity {
  @Column({ name: 'parent_type', type: 'varchar', length: 30, nullable: true })
  parentType?: string | null;

  @Column({ name: 'parent_id', type: 'int', nullable: true })
  parentId?: number | null;

  @Column({ type: 'text', nullable: true })
  body?: string | null;

  @Column({ name: 'author_name', type: 'varchar', length: 190, nullable: true })
  authorName?: string | null;

  @Column({ name: 'import_uid', type: 'varchar', length: 64, nullable: true })
  importUid?: string | null;
}
