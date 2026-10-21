import { Column, Entity, JoinColumn, JoinTable, ManyToMany, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { AppEntity } from './app.entity';
import { PermissionEntity } from './permission.entity';

/** A permission bundle (Odoo "group"). Either a leveled group (dropdown) or standalone (checkbox). */
export enum GroupKind {
  Level = 'level',
  Standalone = 'standalone',
}

@Entity({ name: 'groups' })
export class GroupEntity extends BaseEntity {
  /** null for platform-wide standalone groups; set for app-scoped (leveled or checkbox) groups */
  @ManyToOne(() => AppEntity, (a) => a.groups, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'app_id' })
  app?: AppEntity | null;

  @Column({ name: 'app_id', type: 'int', nullable: true })
  appId?: number | null;

  /** unique key, e.g. 'infra.servers.admin' or 'jobbag.export' */
  @Column({ length: 150, unique: true })
  key: string;

  @Column({ length: 150 })
  label: string;

  @Column({ type: 'enum', enum: GroupKind, default: GroupKind.Standalone })
  kind: GroupKind;

  /** ordering for leveled groups within an app (higher = more privilege) */
  @Column({ type: 'int', nullable: true })
  level?: number | null;

  @ManyToMany(() => PermissionEntity, { cascade: false })
  @JoinTable({
    name: 'group_permissions',
    joinColumn: { name: 'group_id' },
    inverseJoinColumn: { name: 'permission_id' },
  })
  permissions: PermissionEntity[];

  /** groups implied by this one (selecting a level implies lower levels) */
  @ManyToMany(() => GroupEntity)
  @JoinTable({
    name: 'group_implications',
    joinColumn: { name: 'group_id' },
    inverseJoinColumn: { name: 'implies_group_id' },
  })
  implies: GroupEntity[];
}
