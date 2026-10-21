import {
  Body, ConflictException, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, ParseIntPipe,
  Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { DeepPartial, FindOptionsWhere } from 'typeorm';
import { randomUUID } from 'crypto';
import { Reminder } from './entities/reminder.entity';
import { CrudService } from '../common/crud.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

const RES = 'jobbag.reminders';

@Injectable()
class RemindersService extends CrudService<Reminder> {
  constructor(@InjectRepository(Reminder) repo: Repository<Reminder>) {
    super(repo);
  }

  /** reminders attached to a given record — powers the "+ Add" lists shown under any record */
  listByParent(parentType: string, parentId: number) {
    return this.repo.find({
      where: { parentType, parentId } as FindOptionsWhere<Reminder>,
      order: { id: 'DESC' },
    });
  }

  private advance(d: Date, recurrence: string): Date | null {
    const x = new Date(d);
    switch (recurrence) {
      case 'WEEKLY': x.setDate(x.getDate() + 7); return x;
      case 'MONTHLY': x.setMonth(x.getMonth() + 1); return x;
      case 'YEARLY': x.setFullYear(x.getFullYear() + 1); return x;
      default: return null;
    }
  }

  /**
   * Resolve a reminder, attaching a note. `status` is RESOLVED by default; pass 'PENDING_RESOLVED'
   * for the intermediate "handled, awaiting confirmation" state. When a RESOLVED reminder is
   * recurring, the next occurrence is auto-created (WAITING, same series, date advanced by the
   * recurrence interval) — e.g. resolve this month's → next month's reminder appears.
   */
  async resolve(id: number, note?: string, status = 'RESOLVED', userId?: number): Promise<{ resolved: Reminder; next: Reminder | null }> {
    const r = await this.repo.findOne({ where: { id } as FindOptionsWhere<Reminder> });
    if (!r) throw new NotFoundException('Reminder not found');
    // Without this, re-resolving an already-RESOLVED recurring reminder (a double-click, or clicking
    // Resolve again when the button wasn't hidden) spawns ANOTHER "next" occurrence each time — nothing
    // here otherwise stops it, unlike Payments' markPaid which has a spawnedNext flag for exactly this.
    // PENDING_RESOLVED is deliberately still allowed through: DUE -> PENDING_RESOLVED -> RESOLVED is the
    // normal two-step flow, both steps calling this same method.
    if (r.status === 'RESOLVED') throw new ConflictException('This reminder is already resolved.');
    r.status = status === 'PENDING_RESOLVED' ? 'PENDING_RESOLVED' : 'RESOLVED';
    if (note != null && note.trim()) r.resolvedNote = note.trim();
    r.resolvedAt = new Date();
    if (userId) r.resolvedBy = userId;

    let next: Reminder | null = null;
    if (r.status === 'RESOLVED' && r.recurrence && r.recurrence !== 'NONE') {
      const base = r.scheduledDateTime ? new Date(r.scheduledDateTime) : new Date();
      const nextDate = this.advance(base, r.recurrence);
      if (nextDate) {
        const series = r.seriesId || randomUUID();
        r.seriesId = series;
        next = await this.repo.save(this.repo.create({
          userType: r.userType, type: r.type, parentType: r.parentType ?? null, parentId: r.parentId ?? null,
          title: r.title ?? null, recipientUserIds: r.recipientUserIds ?? null, recipientGroupIds: r.recipientGroupIds ?? null,
          emailTo: r.emailTo ?? null, content: r.content ?? null, scheduledDateTime: nextDate,
          status: 'WAITING', recurrence: r.recurrence, seriesId: series, importUid: randomUUID(),
        } as DeepPartial<Reminder>));
      }
    }
    await this.repo.save(r);
    return { resolved: r, next };
  }

  async cancel(id: number): Promise<Reminder> {
    const r = await this.repo.findOne({ where: { id } as FindOptionsWhere<Reminder> });
    if (!r) throw new NotFoundException('Reminder not found');
    r.status = 'CANCELLED';
    return this.repo.save(r);
  }
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('jobbag/reminders')
class RemindersController {
  constructor(private readonly service: RemindersService) {}

  /** list all, or just those attached to a parent record (?parentType=&parentId=) */
  @Get() @RequirePermission('read', RES) list(@Query('parentType') parentType?: string, @Query('parentId') parentId?: string) {
    if (parentType && parentId) return this.service.listByParent(parentType, Number(parentId));
    return this.service.list();
  }
  @Get(':id') @RequirePermission('read', RES) get(@Param('id', ParseIntPipe) id: number) { return this.service.findOne(id); }
  @Post() @RequirePermission('create', RES) create(@Body() dto: DeepPartial<Reminder>) { return this.service.create(dto); }
  @Patch(':id') @RequirePermission('update', RES) update(@Param('id', ParseIntPipe) id: number, @Body() dto: DeepPartial<Reminder>) { return this.service.update(id, dto); }
  /** resolve with a note; recurring reminders auto-spawn the next occurrence. body: { note?, status? } */
  @Post(':id/resolve') @RequirePermission('update', RES) resolve(@Param('id', ParseIntPipe) id: number, @Body() body: { note?: string; status?: string }, @Req() req: { user?: { id?: number } }) {
    return this.service.resolve(id, body?.note, body?.status, req?.user?.id);
  }
  @Post(':id/cancel') @RequirePermission('update', RES) cancel(@Param('id', ParseIntPipe) id: number) { return this.service.cancel(id); }
  @Delete(':id') @RequirePermission('delete', RES) remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}

@Module({
  imports: [TypeOrmModule.forFeature([Reminder])],
  controllers: [RemindersController],
  providers: [RemindersService],
})
export class RemindersModule {}
