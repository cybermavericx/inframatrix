import {
  CreateDateColumn,
  DeleteDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Column,
} from 'typeorm';

/** Shared columns for every entity: id, timestamps, soft delete, audit. */
export abstract class BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt?: Date | null;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy?: number | null;

  @Column({ name: 'updated_by', type: 'int', nullable: true })
  updatedBy?: number | null;
}
