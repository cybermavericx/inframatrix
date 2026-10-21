import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { Environment } from './environment.entity';

@Entity({ name: 'infra_servers' })
export class Server extends BaseEntity {
  /** Reverse side of Environment.server — purely for read (the export field picker's relation
   *  drill-down, "Hosting on this server", etc.); never eagerly loaded by default. */
  @OneToMany(() => Environment, (e) => e.server)
  environments?: Environment[];

  @Column({ name: 'server_name', length: 190, unique: true })
  serverName: string;

  @Column({ name: 'subscription_name', type: 'varchar', length: 190, nullable: true })
  subscriptionName?: string | null;

  @Column({ type: 'varchar', length: 190, nullable: true })
  location?: string | null;

  /** Azure, AWS, Contabo, On-prem, Other (dynamic) */
  @Column({ type: 'varchar', length: 50, nullable: true })
  provider?: string | null;

  /** CloudPanel, Plesk, None (dynamic) */
  @Column({ type: 'varchar', length: 50, nullable: true })
  panel?: string | null;

  @Column({ name: 'os_name', type: 'varchar', length: 100, nullable: true })
  osName?: string | null;

  @Column({ name: 'os_version', type: 'varchar', length: 50, nullable: true })
  osVersion?: string | null;

  /** active, maintenance, decommissioned */
  @Column({ length: 30, default: 'active' })
  status: string;

  /** max number of hostings (environments) this server can hold; null = not tracked / unlimited */
  @Column({ type: 'int', nullable: true })
  capacity?: number | null;

  @Column({ default: false })
  amc: boolean;

  @Column({ name: 'public_ip', type: 'varchar', length: 64, nullable: true })
  publicIp?: string | null;

  @Column({ name: 'private_ip', type: 'varchar', length: 64, nullable: true })
  privateIp?: string | null;

  @Column({ name: 'configured_date', type: 'date', nullable: true })
  configuredDate?: string | null;

  /** JSON array of { name, version } */
  @Column({ type: 'json', nullable: true })
  components?: unknown;

  @Column({ name: 'import_uid', type: 'varchar', length: 64, nullable: true })
  importUid?: string | null;
}
