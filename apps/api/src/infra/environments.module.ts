import {
  Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Patch, Post, UseGuards,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { DeepPartial } from 'typeorm';
import { Environment } from './entities/environment.entity';
import { CrudService } from '../common/crud.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

const RES = 'infra.environments';

@Injectable()
class EnvironmentsService extends CrudService<Environment> {
  constructor(@InjectRepository(Environment) repo: Repository<Environment>) {
    super(repo, ['project', 'server', 'gitProvider'], [], 'environment');
  }
  // Deleting an environment removes its integrations automatically via DB onDelete:CASCADE.
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('infra/environments')
class EnvironmentsController {
  constructor(private readonly service: EnvironmentsService) {}
  @Get() @RequirePermission('read', RES) list() { return this.service.list(); }
  @Get(':id') @RequirePermission('read', RES) get(@Param('id', ParseIntPipe) id: number) { return this.service.findOne(id); }
  @Post() @RequirePermission('create', RES) create(@Body() dto: DeepPartial<Environment>) { return this.service.create(dto); }
  @Patch(':id') @RequirePermission('update', RES) update(@Param('id', ParseIntPipe) id: number, @Body() dto: DeepPartial<Environment>) { return this.service.update(id, dto); }
  @Delete(':id') @RequirePermission('delete', RES) remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}

@Module({ imports: [TypeOrmModule.forFeature([Environment])], controllers: [EnvironmentsController], providers: [EnvironmentsService] })
export class EnvironmentsModule {}
