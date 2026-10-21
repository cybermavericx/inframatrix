import { Column, Entity, JoinTable, ManyToMany } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { ModuleEntity } from '../../rbac/entities/module.entity';
import { GroupEntity } from '../../rbac/entities/group.entity';

@Entity({ name: 'users' })
export class User extends BaseEntity {
  @Column({ length: 150 })
  name: string;

  @Column({ length: 190, unique: true })
  email: string;

  /** bcrypt hash; never selected by default */
  @Column({ select: false })
  password: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  avatar?: string | null;

  @Column({ length: 1, default: 'Y' })
  status: string;

  @Column({ name: 'mfa_enabled', default: false })
  mfaEnabled: boolean;

  /** AES-256-GCM ciphertext (see mfa-crypto.util.ts); never selected by default, like password */
  @Column({ name: 'mfa_secret_encrypted', type: 'varchar', length: 255, nullable: true, select: false })
  mfaSecretEncrypted?: string | null;

  /** Admin-set policy (independent of mfaEnabled) — must have MFA on by mfaRequiredBy or Shell blocks them. */
  @Column({ name: 'mfa_required', default: false })
  mfaRequired: boolean;

  @Column({ name: 'mfa_required_by', type: 'datetime', nullable: true })
  mfaRequiredBy?: Date | null;

  /** which modules (tabs) this user can access */
  @ManyToMany(() => ModuleEntity, { cascade: false })
  @JoinTable({
    name: 'user_modules',
    joinColumn: { name: 'user_id' },
    inverseJoinColumn: { name: 'module_id' },
  })
  modules: ModuleEntity[];

  /** groups granted to this user (drive the effective permissions) */
  @ManyToMany(() => GroupEntity, { cascade: false })
  @JoinTable({
    name: 'user_groups',
    joinColumn: { name: 'user_id' },
    inverseJoinColumn: { name: 'group_id' },
  })
  groups: GroupEntity[];
}
