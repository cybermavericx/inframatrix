import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { DeepPartial } from 'typeorm';
import { Note } from './entities/note.entity';
import { User } from '../users/entities/user.entity';
import { CrudService } from '../common/crud.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { buildAbility } from '../common/casl/ability.factory';
import type { AuthUser } from '../auth/auth.types';
import { ENTITY_RESOURCE } from '../audit/entity-resource';
import { RESOURCE_ENTITIES } from '../data/registry';
import { auditRow, insertAudit } from '../audit/audit.util';

const RES = 'jobbag.notes';

/** The all-notes list (JobBag › Notes) — kept for people with the jobbag.notes permission. */
@Injectable()
class NotesService extends CrudService<Note> {
  constructor(@InjectRepository(Note) repo: Repository<Note>) {
    super(repo);
  }
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('jobbag/notes')
class NotesController {
  constructor(private readonly service: NotesService) {}
  @Get() @RequirePermission('read', RES) list() {
    return this.service.list();
  }
  @Get(':id') @RequirePermission('read', RES) get(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.findOne(id);
  }
  @Post() @RequirePermission('create', RES) create(
    @Body() dto: DeepPartial<Note>,
  ) {
    return this.service.create(dto);
  }
  @Patch(':id') @RequirePermission('update', RES) update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeepPartial<Note>,
  ) {
    return this.service.update(id, dto);
  }
  @Delete(':id') @RequirePermission('delete', RES) remove(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.remove(id);
  }
}

/** Record types that can carry notes, and the permission resource that guards each (same map the
 *  Activity timeline uses). Users are left out: notes about people aren't a use case here. */
const NOTE_PARENTS: Record<string, string> = Object.fromEntries(
  Object.entries(ENTITY_RESOURCE).filter(([type]) => type !== 'user'),
);
const MAX_BODY = 5000;

type NoteView = Note & { canEdit: boolean; canDelete: boolean };

/**
 * Notes on one record (project, environment, server, payment, …). Access follows the RECORD, not a
 * separate notes permission: read the record → read its notes; update the record → add a note. A
 * note can be edited or deleted by its author (while they can still update the record) or by anyone
 * with update/delete on jobbag.notes (moderators, e.g. admins). Edits and deletes are written to the
 * record's change-log, so the old text stays visible in its history.
 */
@Injectable()
class RecordNotesService {
  constructor(
    @InjectRepository(Note) private readonly repo: Repository<Note>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  private resourceFor(parentType: unknown): string {
    const res =
      typeof parentType === 'string' ? NOTE_PARENTS[parentType] : undefined;
    if (!res)
      throw new BadRequestException(
        'Notes are not available for this kind of record.',
      );
    return res;
  }

  private parentIdOf(v: unknown): number {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0)
      throw new BadRequestException(
        'parentId must be a positive whole number.',
      );
    return n;
  }

  private bodyOf(v: unknown): string {
    if (typeof v !== 'string' || !v.trim())
      throw new BadRequestException('Note text is required.');
    const body = v.trim();
    if (body.length > MAX_BODY)
      throw new BadRequestException(
        `A note can be at most ${MAX_BODY} characters.`,
      );
    return body;
  }

  private async assertParentExists(resource: string, id: number) {
    const entity = RESOURCE_ENTITIES[resource];
    const exists = entity
      ? await this.dataSource
          .getRepository(entity)
          .exists({ where: { id } as never })
      : false;
    if (!exists) throw new NotFoundException('That record does not exist.');
  }

  private mayChange(
    user: AuthUser,
    note: Note,
    action: 'update' | 'delete',
  ): boolean {
    const ability = buildAbility(user.permissions);
    if (ability.can(action, RES)) return true;
    const res = NOTE_PARENTS[note.parentType ?? ''];
    return note.createdBy === user.sub && !!res && ability.can('update', res);
  }

  private view(user: AuthUser, n: Note): NoteView {
    return Object.assign(n, {
      canEdit: this.mayChange(user, n, 'update'),
      canDelete: this.mayChange(user, n, 'delete'),
    });
  }

  private async loadForChange(
    user: AuthUser,
    id: number,
    action: 'update' | 'delete',
  ): Promise<Note> {
    const note = await this.repo.findOne({ where: { id } });
    if (!note) throw new NotFoundException('Note not found');
    if (!this.mayChange(user, note, action))
      throw new ForbiddenException("Only the note's author can change it.");
    return note;
  }

  async list(
    user: AuthUser,
    parentType: unknown,
    parentId: unknown,
  ): Promise<NoteView[]> {
    const res = this.resourceFor(parentType);
    const id = this.parentIdOf(parentId);
    if (!buildAbility(user.permissions).can('read', res))
      throw new ForbiddenException();
    const rows = await this.repo.find({
      where: { parentType: parentType as string, parentId: id },
      order: { id: 'DESC' },
    });
    return rows.map((n) => this.view(user, n));
  }

  async add(
    user: AuthUser,
    dto: { parentType?: unknown; parentId?: unknown; body?: unknown },
  ): Promise<NoteView> {
    const res = this.resourceFor(dto.parentType);
    const id = this.parentIdOf(dto.parentId);
    if (!buildAbility(user.permissions).can('update', res))
      throw new ForbiddenException(
        'You need edit access to this record to add a note.',
      );
    const body = this.bodyOf(dto.body);
    await this.assertParentExists(res, id);
    const author = await this.users.findOne({ where: { id: user.sub } });
    const saved = await this.repo.save(
      this.repo.create({
        parentType: dto.parentType as string,
        parentId: id,
        body,
        authorName: author?.name || user.email,
        createdBy: user.sub,
        updatedBy: user.sub,
      }),
    );
    return this.view(user, saved);
  }

  async edit(
    user: AuthUser,
    id: number,
    dto: { body?: unknown },
  ): Promise<NoteView> {
    const note = await this.loadForChange(user, id, 'update');
    const body = this.bodyOf(dto.body);
    const old = note.body ?? '';
    if (body !== old) {
      note.body = body;
      note.updatedBy = user.sub;
      await this.repo.save(note);
      await insertAudit(this.repo.manager, [
        auditRow(note.parentType!, note.parentId!, {
          action: 'updated',
          field: 'note',
          fieldLabel: 'Note edited',
          oldValue: old,
          newValue: body,
        }),
      ]);
    }
    return this.view(user, note);
  }

  async remove(user: AuthUser, id: number) {
    const note = await this.loadForChange(user, id, 'delete');
    await this.repo.delete(id);
    await insertAudit(this.repo.manager, [
      auditRow(note.parentType!, note.parentId!, {
        action: 'updated',
        field: 'note',
        fieldLabel: 'Note deleted',
        oldValue: note.body ?? '',
        newValue: null,
      }),
    ]);
    return { success: true };
  }
}

@UseGuards(JwtAuthGuard)
@Controller('notes')
class RecordNotesController {
  constructor(private readonly service: RecordNotesService) {}
  @Get() list(
    @CurrentUser() user: AuthUser,
    @Query('parentType') parentType?: string,
    @Query('parentId') parentId?: string,
  ) {
    return this.service.list(user, parentType, parentId);
  }
  @Post() add(
    @CurrentUser() user: AuthUser,
    @Body() dto: { parentType?: unknown; parentId?: unknown; body?: unknown },
  ) {
    return this.service.add(user, dto ?? {});
  }
  @Patch(':id') edit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { body?: unknown },
  ) {
    return this.service.edit(user, id, dto ?? {});
  }
  @Delete(':id') remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.remove(user, id);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Note, User])],
  controllers: [NotesController, RecordNotesController],
  providers: [NotesService, RecordNotesService],
})
export class NotesModule {}
