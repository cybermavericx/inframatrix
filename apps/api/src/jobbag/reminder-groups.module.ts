import {
  Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Patch, Post, UseGuards,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { DeepPartial } from 'typeorm';
import { ReminderGroup } from './entities/reminder-group.entity';
import { CrudService } from '../common/crud.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

// Reuses the jobbag.reminders permission so no new RBAC resource/seed is required.
const RES = 'jobbag.reminders';

@Injectable()
class ReminderGroupsService extends CrudService<ReminderGroup> {
  constructor(@InjectRepository(ReminderGroup) repo: Repository<ReminderGroup>) {
    super(repo);
  }
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('jobbag/reminder-groups')
class ReminderGroupsController {
  constructor(private readonly service: ReminderGroupsService) {}
  @Get() @RequirePermission('read', RES) list() { return this.service.list(); }
  @Get(':id') @RequirePermission('read', RES) get(@Param('id', ParseIntPipe) id: number) { return this.service.findOne(id); }
  @Post() @RequirePermission('create', RES) create(@Body() dto: DeepPartial<ReminderGroup>) { return this.service.create(dto); }
  @Patch(':id') @RequirePermission('update', RES) update(@Param('id', ParseIntPipe) id: number, @Body() dto: DeepPartial<ReminderGroup>) { return this.service.update(id, dto); }
  @Delete(':id') @RequirePermission('delete', RES) remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}

@Module({
  imports: [TypeOrmModule.forFeature([ReminderGroup])],
  controllers: [ReminderGroupsController],
  providers: [ReminderGroupsService],
})
export class ReminderGroupsModule {}
