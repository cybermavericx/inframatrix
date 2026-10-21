import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

/**
 * A polymorphic file attachment for ANY record (the generic "+ Attach" / Odoo-chatter-style flow).
 * `parentType`/`parentId` reference the owning record (e.g. 'payment', 'vendor_service', 'client').
 * `filePath` is the `/uploads/...` path returned by `POST /uploads`; `invoiceNumber` lets a paid
 * Payment record its invoice reference next to the attached invoice file (the original ask), but the
 * field is generic so any attachment can carry a reference number.
 */
@Entity({ name: 'jb_attachments' })
export class Attachment extends BaseEntity {
  @Column({ name: 'parent_type', type: 'varchar', length: 30, nullable: true })
  parentType?: string | null;

  @Column({ name: 'parent_id', type: 'int', nullable: true })
  parentId?: number | null;

  /** the /uploads path returned by POST /uploads */
  @Column({ name: 'file_path', type: 'varchar', length: 255, nullable: true })
  filePath?: string | null;

  /** original filename, for display */
  @Column({ name: 'file_name', type: 'varchar', length: 255, nullable: true })
  fileName?: string | null;

  /** optional invoice / reference number (e.g. for a paid payment's invoice) */
  @Column({ name: 'invoice_number', type: 'varchar', length: 100, nullable: true })
  invoiceNumber?: string | null;

  /** optional free-text label/description */
  @Column({ type: 'varchar', length: 255, nullable: true })
  description?: string | null;

  @Column({ name: 'author_name', type: 'varchar', length: 190, nullable: true })
  authorName?: string | null;

  @Column({ name: 'import_uid', type: 'varchar', length: 64, nullable: true })
  importUid?: string | null;
}
