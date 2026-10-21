import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { VendorService } from './vendor-service.entity';
import { Client } from './client.entity';

@Entity({ name: 'jb_jobs' })
export class Job extends BaseEntity {
  @Column({ name: 'unique_id', type: 'varchar', length: 30, nullable: true })
  uniqueId?: string | null;

  @Column({ length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  /** optional linked vendor-service (the vendor is shown via this relation) */
  @ManyToOne(() => VendorService, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'vendor_service_id' })
  vendorService?: VendorService | null;

  @Column({ name: 'vendor_service_id', type: 'int', nullable: true })
  vendorServiceId?: number | null;

  /** optional linked client */
  @ManyToOne(() => Client, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'client_id' })
  client?: Client | null;

  @Column({ name: 'client_id', type: 'int', nullable: true })
  clientId?: number | null;

  /** what to do — the job action / note */
  @Column({ type: 'text', nullable: true })
  action?: string | null;

  @Column({ name: 'client_name', type: 'varchar', length: 190, nullable: true })
  clientName?: string | null;

  @Column({ name: 'requested_by', type: 'varchar', length: 190, nullable: true })
  requestedBy?: string | null;

  @Column({ name: 'requester_email', type: 'varchar', length: 190, nullable: true })
  requesterEmail?: string | null;

  /** REQUEST_CREATED, QUOTE_CREATED, INVOICE_REQUESTED, INVOICE_CREATED, PAYMENT_RECEIVED, COMPLETED, DROPPED */
  @Column({ name: 'project_status', length: 40, default: 'REQUEST_CREATED' })
  projectStatus: string;

  @Column({ length: 1, default: 'Y' })
  status: string;

  @Column({ name: 'import_uid', type: 'varchar', length: 64, nullable: true })
  importUid?: string | null;
}
