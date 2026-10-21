import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

@Entity({ name: 'infra_git_providers' })
export class GitProvider extends BaseEntity {
  /** GitHub, GitLab, Other */
  @Column({ length: 120, unique: true })
  name: string;

  @Column({ name: 'base_url', type: 'varchar', length: 255, nullable: true })
  baseUrl?: string | null;

  @Column({ name: 'import_uid', type: 'varchar', length: 64, nullable: true })
  importUid?: string | null;
}
