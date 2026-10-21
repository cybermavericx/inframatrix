import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { AppEntity } from './app.entity';

/** Top-level section the user can access: 'infra' | 'jobbag'. Drives the tabs. */
@Entity({ name: 'modules' })
export class ModuleEntity extends BaseEntity {
  @Column({ length: 50, unique: true })
  key: string;

  @Column({ length: 100 })
  label: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  icon?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  route?: string | null;

  @Column({ default: 0 })
  sort: number;

  @OneToMany(() => AppEntity, (app) => app.module)
  apps: AppEntity[];
}
