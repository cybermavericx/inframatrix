import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

/**
 * A reminder distribution list (e.g. "Accounts", "Management"). Purely a who-gets-the-mail list —
 * independent of RBAC permission groups. Members are stored as a JSON array of user ids.
 */
@Entity({ name: 'jb_reminder_groups' })
export class ReminderGroup extends BaseEntity {
  @Column({ length: 150 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  /** user ids that belong to this distribution list */
  @Column({ name: 'member_user_ids', type: 'simple-json', nullable: true })
  memberUserIds?: number[] | null;

  @Column({ name: 'import_uid', type: 'varchar', length: 64, nullable: true })
  importUid?: string | null;
}
