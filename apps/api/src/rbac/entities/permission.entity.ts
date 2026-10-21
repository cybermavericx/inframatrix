import { Column, Entity, Unique } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

/** A model-CRUD permission (Odoo "Access Rights" / ir.model.access). */
export enum PermissionAction {
  Read = 'read',
  Create = 'create',
  Update = 'update',
  Delete = 'delete',
}

@Entity({ name: 'permissions' })
@Unique(['resource', 'action'])
export class PermissionEntity extends BaseEntity {
  /** e.g. 'infra.servers' | 'jobbag.jobs' */
  @Column({ length: 120 })
  resource: string;

  @Column({ type: 'enum', enum: PermissionAction })
  action: PermissionAction;
}
