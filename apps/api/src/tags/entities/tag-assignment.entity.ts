import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { Tag } from './tag.entity';

/**
 * One tag attached to one record (polymorphic, like notes/reminders). `parentType`/`parentId` is the
 * tagged record (e.g. 'server' #5). Removal is a soft-detach: `removedAt` is set rather than deleting
 * the row, so a record keeps the history of flags it once carried (created-at = when attached). A
 * row is "active" while `removedAt` is null. Environments inherit their server's active tags at read
 * time (see TagsService.listResolved) — no inheritance rows are stored.
 */
@Entity({ name: 'tag_assignments' })
@Index(['parentType', 'parentId'])
export class TagAssignment extends BaseEntity {
  @ManyToOne(() => Tag, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tag_id' })
  tag?: Tag | null;

  @Column({ name: 'tag_id', type: 'int' })
  tagId: number;

  @Column({ name: 'parent_type', length: 30 })
  parentType: string;

  @Column({ name: 'parent_id', type: 'int' })
  parentId: number;

  @Column({ name: 'removed_at', type: 'datetime', nullable: true })
  removedAt?: Date | null;

  @Column({ name: 'removed_by', type: 'int', nullable: true })
  removedBy?: number | null;

  @Column({ name: 'import_uid', type: 'varchar', length: 64, nullable: true })
  importUid?: string | null;
}
