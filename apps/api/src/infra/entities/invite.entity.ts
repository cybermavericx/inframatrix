import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

@Entity({ name: 'infra_invites' })
export class Invite extends BaseEntity {
  @Column({ length: 190 })
  email: string;

  @Column({ length: 64 })
  token: string;

  @Column({ name: 'expires_at', type: 'datetime', nullable: true })
  expiresAt?: Date | null;

  @Column({ name: 'accepted_at', type: 'datetime', nullable: true })
  acceptedAt?: Date | null;

  /** intended access, chosen by the admin at invite time (JSON arrays) */
  @Column({ name: 'module_keys', type: 'text', nullable: true })
  moduleKeys?: string | null;

  @Column({ name: 'group_keys', type: 'text', nullable: true })
  groupKeys?: string | null;
}
