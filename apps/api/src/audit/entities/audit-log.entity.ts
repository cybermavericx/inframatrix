import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One entry in a record's change-log (the Odoo "chatter" timeline). Append-only — never edited or
 * soft-deleted. `entityType`/`entityId` reference the owning record (e.g. 'server' #5), mirroring the
 * polymorphic parentType convention used by notes/reminders. A field edit writes one row per changed
 * column (action 'updated', with field + old/new); create/delete write a single row with no field.
 */
@Entity({ name: 'audit_log' })
@Index(['entityType', 'entityId'])
export class AuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'entity_type', length: 40 })
  entityType: string;

  @Column({ name: 'entity_id', type: 'int' })
  entityId: number;

  /** created | updated | deleted */
  @Column({ length: 12 })
  action: string;

  /** changed column name (only for action 'updated'); null for create/delete */
  @Column({ type: 'varchar', length: 80, nullable: true })
  field?: string | null;

  /** human-friendly label for `field` (e.g. "Server name") */
  @Column({ name: 'field_label', type: 'varchar', length: 140, nullable: true })
  fieldLabel?: string | null;

  @Column({ name: 'old_value', type: 'text', nullable: true })
  oldValue?: string | null;

  @Column({ name: 'new_value', type: 'text', nullable: true })
  newValue?: string | null;

  /** optional free-text summary (used for tag attach/remove and other semantic events) */
  @Column({ type: 'varchar', length: 255, nullable: true })
  message?: string | null;

  /** readable name of the record at the time of the change ("Hostinger", "bespokeliving.com · live") —
   *  lets the global Activity Log name a record even after it's been deleted. Null on older rows. */
  @Column({ name: 'entity_label', type: 'varchar', length: 255, nullable: true })
  entityLabel?: string | null;

  /** true for a copy written onto a PARENT's timeline (e.g. an environment's change shown on its
   *  project) — the original row exists too, so the global log skips mirrors to avoid duplicates. */
  @Column({ type: 'boolean', default: false })
  mirror: boolean;

  @Column({ name: 'author_id', type: 'int', nullable: true })
  authorId?: number | null;

  @Column({ name: 'author_name', type: 'varchar', length: 190, nullable: true })
  authorName?: string | null;
}
