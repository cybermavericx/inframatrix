import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

/** A record of a triggered notification (reminder fired, vendor-service expiry, ...). */
@Entity({ name: 'jb_notifications' })
export class NotificationLog extends BaseEntity {
  /** REMINDER | VENDOR_EXPIRY */
  @Column({ length: 40, default: 'REMINDER' })
  source: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  subject?: string | null;

  @Column({ type: 'text', nullable: true })
  message?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  recipient?: string | null;

  /** SENT | FAILED */
  @Column({ length: 20, default: 'SENT' })
  status: string;

  @Column({ name: 'reminder_id', type: 'int', nullable: true })
  reminderId?: number | null;

  @Column({ name: 'sent_at', type: 'datetime', nullable: true })
  sentAt?: Date | null;
}
