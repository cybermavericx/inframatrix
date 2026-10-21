import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

/**
 * Every mail the system attempts to send is recorded here — sent, failed, or merely stored when no
 * provider is configured. This is the viewable fallback so nothing is ever silently lost.
 */
@Entity({ name: 'jb_outbox' })
export class Outbox extends BaseEntity {
  @Column({ name: 'to_addr', type: 'text', nullable: true })
  toAddr?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  subject?: string | null;

  /** full rendered HTML body */
  @Column({ type: 'longtext', nullable: true })
  body?: string | null;

  /** QUEUED | SENT | FAILED | STORED  (STORED = saved only, no provider configured) */
  @Column({ length: 20, default: 'QUEUED' })
  status: string;

  /** 'smtp' | 'sendgrid' | null */
  @Column({ type: 'varchar', length: 20, nullable: true })
  provider?: string | null;

  @Column({ type: 'text', nullable: true })
  error?: string | null;

  @Column({ name: 'sent_at', type: 'datetime', nullable: true })
  sentAt?: Date | null;

  @Column({ name: 'related_type', type: 'varchar', length: 30, nullable: true })
  relatedType?: string | null;

  @Column({ name: 'related_id', type: 'int', nullable: true })
  relatedId?: number | null;

  @Column({ name: 'import_uid', type: 'varchar', length: 64, nullable: true })
  importUid?: string | null;
}
