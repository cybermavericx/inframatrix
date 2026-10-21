import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

/**
 * A reminder can be attached to ANY record (the generic "+ Add reminder" flow): a payment, a
 * vendor-service, a client, a vendor, a job, etc. It carries recipients, a schedule, an optional
 * repeat, and a resolve-with-note lifecycle.
 *
 * Lifecycle:  WAITING ──(its date arrives → email fires)──▶ DUE
 *             DUE ──(someone clicks Resolve, adds a note)──▶ PENDING_RESOLVED ──(confirm)──▶ RESOLVED
 *             any ──(cancel)──▶ CANCELLED
 * When a recurring reminder is resolved, the next occurrence is auto-created (same series).
 */
@Entity({ name: 'jb_reminders' })
export class Reminder extends BaseEntity {
  /** MYSELF, OTHERS — legacy, kept for back-compat */
  @Column({ name: 'user_type', length: 20, default: 'MYSELF' })
  userType: string;

  /** COMMON, JOB_SERVICE, VENDOR_SERVICE — legacy bucket, kept for back-compat */
  @Column({ length: 30, default: 'COMMON' })
  type: string;

  /** what this reminder is attached to: 'payment' | 'vendor_service' | 'client' | 'vendor' | 'job'
   *  (null = standalone). Generic — any module can be a parent. */
  @Column({ name: 'parent_type', type: 'varchar', length: 30, nullable: true })
  parentType?: string | null;

  /** id of the parent row */
  @Column({ name: 'parent_id', type: 'int', nullable: true })
  parentId?: number | null;

  /** short label shown in lists, e.g. "Renew SSL cert" */
  @Column({ type: 'varchar', length: 200, nullable: true })
  title?: string | null;

  /** recipient user ids (resolved to emails when the reminder fires) */
  @Column({ name: 'recipient_user_ids', type: 'simple-json', nullable: true })
  recipientUserIds?: number[] | null;

  /** recipient reminder-group ids (each expands to its member users) */
  @Column({ name: 'recipient_group_ids', type: 'simple-json', nullable: true })
  recipientGroupIds?: number[] | null;

  /** extra free-text recipient emails (comma-separated), in addition to users/groups */
  @Column({ name: 'email_to', type: 'text', nullable: true })
  emailTo?: string | null;

  @Column({ type: 'text', nullable: true })
  content?: string | null;

  /** when the reminder should fire / become DUE */
  @Column({ name: 'scheduled_date_time', type: 'datetime', nullable: true })
  scheduledDateTime?: Date | null;

  /** WAITING, DUE, PENDING_RESOLVED, RESOLVED, CANCELLED */
  @Column({ length: 20, default: 'WAITING' })
  status: string;

  /** NONE, WEEKLY, MONTHLY, YEARLY — when set, resolving spawns the next occurrence */
  @Column({ length: 20, default: 'NONE' })
  recurrence: string;

  /** groups all occurrences of one recurring reminder */
  @Column({ name: 'series_id', type: 'varchar', length: 64, nullable: true })
  seriesId?: string | null;

  /** when fired (WAITING → DUE) */
  @Column({ name: 'fired_at', type: 'datetime', nullable: true })
  firedAt?: Date | null;

  /** resolution note + audit */
  @Column({ name: 'resolved_note', type: 'text', nullable: true })
  resolvedNote?: string | null;

  @Column({ name: 'resolved_at', type: 'datetime', nullable: true })
  resolvedAt?: Date | null;

  @Column({ name: 'resolved_by', type: 'int', nullable: true })
  resolvedBy?: number | null;

  @Column({ name: 'import_uid', type: 'varchar', length: 64, nullable: true })
  importUid?: string | null;
}
