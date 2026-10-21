import { Controller, ForbiddenException, Get, Injectable, Module, Query, UseGuards } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { In, Like, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { AuditLog } from './entities/audit-log.entity';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { buildAbility } from '../common/casl/ability.factory';
import type { AuthUser } from '../auth/auth.types';

/** Every entityType this app's change-log/activity timeline actually writes (CrudService's
 *  `auditType` constructor arg, plus TagsService's `parentType`-keyed entries — see resources.ts's
 *  `parentType` overrides on the web side for where each one comes from), mapped to the permission
 *  resource that should gate reading it. An entityType not listed here is refused rather than
 *  silently allowed — change history can reveal old field values a user was never granted read
 *  access to, so an unrecognised type should fail closed, not open. */
const ENTITY_RESOURCE: Record<string, string> = {
  project: 'infra.projects',
  server: 'infra.servers',
  environment: 'infra.environments',
  git_provider: 'infra.git-providers',
  integration_type: 'infra.integration-types',
  account: 'infra.accounts',
  integration: 'infra.integrations',
  user: 'core.users',
  client: 'jobbag.clients',
  vendor: 'jobbag.vendors',
  vendor_service: 'jobbag.vendor-services',
  payment: 'jobbag.payments',
  job: 'jobbag.jobs',
};

/** Read-only access to a record's change-log timeline. Writing is done inline by CrudService /
 *  TagsService (via the shared AuditLog repository), so this module only needs the read side. */
@Injectable()
class AuditService {
  constructor(
    @InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  /** Show who did it by their CURRENT name, not the email captured when the row was written: log rows
   *  keep authorId, and an email/name change must not leave a person's history under a stale identity
   *  (nor split it across two). `authorName` falls back to the stored text for deleted/unknown users,
   *  system writes, and rows without an id. `authorEmail` is the current email (tooltip / CSV). */
  private async withAuthors<T extends AuditLog>(rows: T[]) {
    const ids = [...new Set(rows.map((r) => r.authorId).filter((x): x is number => x != null))];
    const found = ids.length ? await this.users.find({ where: { id: In(ids) }, withDeleted: true }) : [];
    const byId = new Map(found.map((u) => [u.id, u]));
    return rows.map((r) => {
      const u = r.authorId != null ? byId.get(r.authorId) : undefined;
      return { ...r, authorName: u?.name || u?.email || r.authorName, authorEmail: u?.email ?? r.authorName ?? null };
    });
  }

  /** ids of users whose current name/email matches a search term (so "alice" finds their old rows too). */
  private async userIdsLike(term: string): Promise<number[]> {
    const like = `%${term}%`;
    const us = await this.users.find({ where: [{ name: Like(like) }, { email: Like(like) }], withDeleted: true, select: { id: true } });
    return us.map((u) => u.id);
  }
  /** Filtered, paged change-log (newest first) for the Activity Log screens — one record's full history,
   *  or (no entityId) the system-wide log. Mirror rows (copies written onto a parent's timeline) are
   *  hidden from the system-wide view, where the original row already appears. */
  async search(f: { entityType?: string; entityId?: number; author?: string; q?: string; from?: string; to?: string; page: number; limit: number }) {
    const qb = this.repo.createQueryBuilder('a').orderBy('a.id', 'DESC');
    if (f.entityType) qb.andWhere('a.entityType = :t', { t: f.entityType });
    if (f.entityId) qb.andWhere('a.entityId = :id', { id: f.entityId });
    else qb.andWhere('a.mirror = 0');
    if (f.author) {
      const ids = await this.userIdsLike(f.author);
      qb.andWhere(`(a.authorName LIKE :au${ids.length ? ' OR a.authorId IN (:...auIds)' : ''})`, { au: `%${f.author}%`, auIds: ids });
    }
    if (f.from) qb.andWhere('a.createdAt >= :from', { from: `${f.from} 00:00:00` });
    if (f.to) qb.andWhere('a.createdAt < DATE_ADD(:to, INTERVAL 1 DAY)', { to: `${f.to} 00:00:00` });
    if (f.q) {
      const ids = await this.userIdsLike(f.q);
      qb.andWhere(
        `(a.entityLabel LIKE :q OR a.fieldLabel LIKE :q OR a.message LIKE :q OR a.oldValue LIKE :q OR a.newValue LIKE :q OR a.authorName LIKE :q${ids.length ? ' OR a.authorId IN (:...qIds)' : ''})`,
        { q: `%${f.q}%`, qIds: ids },
      );
    }
    const [rows, total] = await qb.skip((f.page - 1) * f.limit).take(f.limit).getManyAndCount();
    return { rows: await this.withAuthors(rows), total, page: f.page, limit: f.limit };
  }

  /** The change timeline for one record (newest first). */
  async listForEntity(entityType: string, entityId: number) {
    return this.withAuthors(await this.repo.find({ where: { entityType, entityId }, order: { id: 'DESC' } }));
  }
}

@UseGuards(JwtAuthGuard)
@Controller('audit')
class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('entityType') entityType?: string, @Query('entityId') entityId?: string) {
    if (!entityType || !entityId) return [];
    const resource = ENTITY_RESOURCE[entityType];
    if (!resource || !buildAbility(user.permissions).can('read', resource)) throw new ForbiddenException();
    return this.service.listForEntity(entityType, Number(entityId));
  }

  /** Full, filterable history. With entityType+entityId it's that record's history (needs read on it);
   *  without them it's the system-wide Activity Log, an administrator view (needs read on Users). */
  @Get('log')
  log(
    @CurrentUser() user: AuthUser,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('author') author?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const ability = buildAbility(user.permissions);
    const id = entityId ? Number(entityId) : undefined;
    if (id) {
      const resource = entityType ? ENTITY_RESOURCE[entityType] : undefined;
      if (!resource || !ability.can('read', resource)) throw new ForbiddenException();
    } else if (!ability.can('read', 'core.users')) {
      throw new ForbiddenException();
    }
    const day = /^\d{4}-\d{2}-\d{2}$/;
    return this.service.search({
      entityType: entityType || undefined,
      entityId: id,
      author: author?.trim() || undefined,
      q: q?.trim() || undefined,
      from: from && day.test(from) ? from : undefined,
      to: to && day.test(to) ? to : undefined,
      page: Math.max(1, Number(page) || 1),
      limit: Math.min(500, Math.max(1, Number(limit) || 50)),
    });
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog, User])],
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
