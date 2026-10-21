import {
  Body, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, ParseIntPipe,
  Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { DeepPartial, FindOptionsWhere } from 'typeorm';
import { Tag } from './entities/tag.entity';
import { TagAssignment } from './entities/tag-assignment.entity';
import { Environment } from '../infra/entities/environment.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { auditRow } from '../audit/audit.util';
import { currentUser } from '../common/request-context';
import { CrudService } from '../common/crud.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

const RES = 'infra.tags';

/** An assignment row with the tag joined and, for inherited rows, where it came from. */
type ResolvedAssignment = TagAssignment & { inherited?: boolean; inheritedFrom?: string };

@Injectable()
class TagsService extends CrudService<Tag> {
  constructor(
    @InjectRepository(Tag) repo: Repository<Tag>,
    @InjectRepository(TagAssignment) private readonly assignRepo: Repository<TagAssignment>,
    @InjectRepository(Environment) private readonly envRepo: Repository<Environment>,
  ) {
    super(repo);
  }

  /** The reusable master list, alphabetical (drives the "+ Tag" suggestions). */
  masterList() {
    return this.repo.find({ order: { name: 'ASC' } as never });
  }

  private logTimeline(row: Partial<AuditLog>) {
    return this.assignRepo.manager.getRepository(AuditLog).insert(row).catch(() => undefined);
  }

  /** Find a tag by exact (case-insensitive) name, or create it — so the same flag is never duplicated. */
  private async resolveTag(tagId?: number, name?: string, color?: string): Promise<Tag> {
    if (tagId) {
      const t = await this.repo.findOne({ where: { id: tagId } as FindOptionsWhere<Tag> });
      if (t) return t;
    }
    const clean = (name ?? '').trim();
    if (!clean) throw new NotFoundException('A tag id or name is required.');
    const existing = await this.repo
      .createQueryBuilder('t')
      .where('LOWER(t.name) = LOWER(:n)', { n: clean })
      .getOne();
    if (existing) return existing;
    return this.create({ name: clean, color: color ?? null } as DeepPartial<Tag>);
  }

  /** Active (or, with history, all) assignments for a record, with the tag joined. Environments also
   *  inherit their server's active tags (read-time, flagged inherited). */
  async listResolved(parentType: string, parentId: number, history: boolean): Promise<ResolvedAssignment[]> {
    const own = await this.assignRepo.find({
      where: { parentType, parentId, ...(history ? {} : { removedAt: IsNull() }) } as FindOptionsWhere<TagAssignment>,
      relations: { tag: true },
      order: { id: 'DESC' },
    });
    if (parentType !== 'environment') return own;
    // an environment also shows the flags on the server it is hosted on
    const env = await this.envRepo.findOne({ where: { id: parentId } as FindOptionsWhere<Environment> });
    if (!env?.serverId) return own;
    const fromServer = await this.assignRepo.find({
      where: { parentType: 'server', parentId: env.serverId, removedAt: IsNull() } as FindOptionsWhere<TagAssignment>,
      relations: { tag: true },
      order: { id: 'DESC' },
    });
    const inherited: ResolvedAssignment[] = fromServer.map((a) => ({ ...a, inherited: true, inheritedFrom: 'server' }));
    return [...inherited, ...own];
  }

  /** Attach a tag (by id or name) to a record. Re-attaching an already-active tag is a no-op. */
  async assign(body: { tagId?: number; name?: string; color?: string; parentType: string; parentId: number }): Promise<ResolvedAssignment> {
    const tag = await this.resolveTag(body.tagId, body.name, body.color);
    const active = await this.assignRepo.findOne({
      where: { parentType: body.parentType, parentId: body.parentId, tagId: tag.id, removedAt: IsNull() } as FindOptionsWhere<TagAssignment>,
      relations: { tag: true },
    });
    if (active) return active;
    const saved = await this.assignRepo.save(this.assignRepo.create({
      tagId: tag.id, parentType: body.parentType, parentId: body.parentId,
    }));
    await this.logTimeline(auditRow(body.parentType, body.parentId, {
      action: 'updated', field: 'tags', fieldLabel: 'Tags', message: `Tag added: ${tag.name}`, newValue: tag.name,
    }));
    return { ...saved, tag };
  }

  /** Soft-detach an assignment (keeps it in history) and log it on the record's timeline. */
  async removeAssignment(id: number): Promise<TagAssignment> {
    const a = await this.assignRepo.findOne({ where: { id } as FindOptionsWhere<TagAssignment>, relations: { tag: true } });
    if (!a) throw new NotFoundException('Tag assignment not found');
    if (!a.removedAt) {
      a.removedAt = new Date();
      a.removedBy = currentUser().userId ?? null;
      await this.assignRepo.save(a);
      await this.logTimeline(auditRow(a.parentType, a.parentId, {
        action: 'updated', field: 'tags', fieldLabel: 'Tags', message: `Tag removed: ${a.tag?.name ?? ''}`, oldValue: a.tag?.name ?? '',
      }));
    }
    return a;
  }
}

// ---- master tag list (reusable catalogue) ----
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('infra/tags')
class TagsController {
  constructor(private readonly service: TagsService) {}
  @Get() @RequirePermission('read', RES) list() { return this.service.masterList(); }
  @Get(':id') @RequirePermission('read', RES) get(@Param('id', ParseIntPipe) id: number) { return this.service.findOne(id); }
  @Post() @RequirePermission('create', RES) create(@Body() dto: DeepPartial<Tag>) { return this.service.create(dto); }
  @Patch(':id') @RequirePermission('update', RES) update(@Param('id', ParseIntPipe) id: number, @Body() dto: DeepPartial<Tag>) { return this.service.update(id, dto); }
  @Delete(':id') @RequirePermission('delete', RES) remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}

// ---- attaching tags to records ----
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('infra/tag-assignments')
class TagAssignmentsController {
  constructor(private readonly service: TagsService) {}

  @Get() @RequirePermission('read', RES)
  list(@Query('parentType') parentType?: string, @Query('parentId') parentId?: string, @Query('history') history?: string) {
    if (!parentType || !parentId) return [];
    return this.service.listResolved(parentType, Number(parentId), history === '1' || history === 'true');
  }

  @Post() @RequirePermission('create', RES)
  assign(@Body() body: { tagId?: number; name?: string; color?: string; parentType: string; parentId: number }) {
    return this.service.assign(body);
  }

  @Post(':id/remove') @RequirePermission('update', RES)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeAssignment(id);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Tag, TagAssignment, Environment])],
  controllers: [TagsController, TagAssignmentsController],
  providers: [TagsService],
})
export class TagsModule {}
