import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { GroupEntity } from './entities/group.entity';
import { PermissionClaim } from '../auth/auth.types';

export interface ResolvedAccess {
  modules: string[];
  permissions: PermissionClaim[];
}

@Injectable()
export class RbacService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  /** Compute a user's accessible module keys + effective permissions (groups + implied groups). */
  async resolveForUser(userId: number): Promise<ResolvedAccess> {
    const user = await this.users.findOne({
      where: { id: userId },
      relations: {
        modules: true,
        groups: { permissions: true, implies: { permissions: true } },
      },
    });
    if (!user) return { modules: [], permissions: [] };

    const modules = (user.modules ?? []).map((m) => m.key);

    const map = new Map<string, PermissionClaim>();
    const collect = (g?: GroupEntity) => {
      for (const p of g?.permissions ?? []) {
        map.set(`${p.action}:${p.resource}`, { action: p.action, resource: p.resource });
      }
    };
    for (const g of user.groups ?? []) {
      collect(g);
      for (const implied of g.implies ?? []) collect(implied);
    }

    return { modules, permissions: [...map.values()] };
  }
}
