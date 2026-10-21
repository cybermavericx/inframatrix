import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { Project } from './project.entity';
import { Server } from './server.entity';
import { GitProvider } from './git-provider.entity';
import { User } from '../../users/entities/user.entity';

@Entity({ name: 'infra_environments' })
export class Environment extends BaseEntity {
  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project?: Project | null;

  @Column({ name: 'project_id', type: 'int', nullable: true })
  projectId?: number | null;

  /** staging, uat, live */
  @Column({ length: 20 })
  type: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  url?: string | null;

  @ManyToOne(() => Server, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'server_id' })
  server?: Server | null;

  @Column({ name: 'server_id', type: 'int', nullable: true })
  serverId?: number | null;

  @ManyToOne(() => GitProvider, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'git_provider_id' })
  gitProvider?: GitProvider | null;

  @Column({ name: 'git_provider_id', type: 'int', nullable: true })
  gitProviderId?: number | null;

  @Column({ name: 'repo_url', type: 'varchar', length: 255, nullable: true })
  repoUrl?: string | null;

  @Column({ name: 'repo_branch', type: 'varchar', length: 120, nullable: true })
  repoBranch?: string | null;

  /** 'auto' (webhook, pushes deploy automatically) | 'manual' (repo connected, deployed by clicking
   *  "Deploy now" / a manual pull) | 'disabled' (no repo connected — FTP-only deployment). Null/unset
   *  is treated the same as 'disabled' by readiness.util.ts — nothing has affirmatively been set up. */
  @Column({ name: 'cicd_status', type: 'varchar', length: 20, nullable: true })
  cicdStatus?: string | null;

  /** Only expected to be filled when cicdStatus is 'disabled' — why this environment has no repo/CI
   *  connected (e.g. "client requires FTP-only"). */
  @Column({ name: 'cicd_not_configured_reason', type: 'text', nullable: true })
  cicdNotConfiguredReason?: string | null;

  @Column({ name: 'checklist_attachment', type: 'varchar', length: 255, nullable: true })
  checklistAttachment?: string | null;

  @Column({ name: 'checklist_completed', default: false })
  checklistCompleted: boolean;

  @Column({ name: 'checklist_not_completed_reason', type: 'text', nullable: true })
  checklistNotCompletedReason?: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'checklist_submitted_by' })
  checklistSubmittedBy?: User | null;

  @Column({ name: 'checklist_submitted_by', type: 'int', nullable: true })
  checklistSubmittedById?: number | null;

  @Column({ name: 'checklist_submitted_date', type: 'date', nullable: true })
  checklistSubmittedDate?: string | null;

  @Column({ name: 'checklist_submitted_version', type: 'varchar', length: 60, nullable: true })
  checklistSubmittedVersion?: string | null;

  @Column({ name: 'import_uid', type: 'varchar', length: 64, nullable: true })
  importUid?: string | null;
}
