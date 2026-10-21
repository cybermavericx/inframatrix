import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

@Entity({ name: 'password_resets' })
export class PasswordReset extends BaseEntity {
  @Column({ length: 190 })
  email: string;

  @Column({ length: 255 })
  token: string;

  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt: Date;
}
