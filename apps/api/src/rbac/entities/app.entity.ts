import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { ModuleEntity } from './module.entity';
import { GroupEntity } from './group.entity';

/** A functional category within a module (Odoo "Application access" category). */
@Entity({ name: 'apps' })
export class AppEntity extends BaseEntity {
  @ManyToOne(() => ModuleEntity, (m) => m.apps, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'module_id' })
  module: ModuleEntity;

  @Column({ name: 'module_id' })
  moduleId: number;

  @Column({ length: 80 })
  key: string;

  @Column({ length: 120 })
  label: string;

  @Column({ default: 0 })
  sort: number;

  @OneToMany(() => GroupEntity, (g) => g.app)
  groups: GroupEntity[];
}
