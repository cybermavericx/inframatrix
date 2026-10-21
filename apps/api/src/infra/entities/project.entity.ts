import { Column, Entity, JoinColumn, JoinTable, ManyToMany, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { User } from '../../users/entities/user.entity';
import { Environment } from './environment.entity';

@Entity({ name: 'infra_projects' })
export class Project extends BaseEntity {
  /** Reverse side of Environment.project — read-only, for the export field picker's drill-down. */
  @OneToMany(() => Environment, (e) => e.project)
  environments?: Environment[];

  @Column({ length: 190 })
  name: string;

  /** active, on_hold, archived */
  @Column({ length: 30, default: 'active' })
  status: string;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  /** Point of Contact */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'poc_user_id' })
  poc?: User | null;

  @Column({ name: 'poc_user_id', type: 'int', nullable: true })
  pocUserId?: number | null;

  /** Developers working on this project — any number, picked from the Users list. Join table
   *  `infra_project_developers` (created by migration 2026-10-07-project-developers.sql). */
  @ManyToMany(() => User, { cascade: false })
  @JoinTable({
    name: 'infra_project_developers',
    joinColumn: { name: 'project_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'user_id', referencedColumnName: 'id' },
  })
  developers?: User[];

  @Column({ name: 'is_published', default: false })
  isPublished: boolean;

  /** active, inactive, internal */
  @Column({ name: 'amc_status', type: 'varchar', length: 20, nullable: true })
  amcStatus?: string | null;

  @Column({ name: 'amc_from', type: 'date', nullable: true })
  amcFrom?: string | null;

  @Column({ name: 'amc_to', type: 'date', nullable: true })
  amcTo?: string | null;

  @Column({ name: 'import_uid', type: 'varchar', length: 64, nullable: true })
  importUid?: string | null;
}
