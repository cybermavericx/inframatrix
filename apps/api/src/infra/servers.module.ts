import {
  Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Patch, Post, UseGuards,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { DeepPartial } from 'typeorm';
import { Server } from './entities/server.entity';
import { CrudService } from '../common/crud.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Injectable()
class ServersService extends CrudService<Server> {
  constructor(@InjectRepository(Server) repo: Repository<Server>) {
    super(repo, [], [], 'server');
  }
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('infra/servers')
class ServersController {
  constructor(private readonly service: ServersService) {}
  @Get() @RequirePermission('read', 'infra.servers') list() { return this.service.list(); }
  @Get(':id') @RequirePermission('read', 'infra.servers') get(@Param('id', ParseIntPipe) id: number) { return this.service.findOne(id); }
  @Post() @RequirePermission('create', 'infra.servers') create(@Body() dto: DeepPartial<Server>) { return this.service.create(dto); }
  @Patch(':id') @RequirePermission('update', 'infra.servers') update(@Param('id', ParseIntPipe) id: number, @Body() dto: DeepPartial<Server>) { return this.service.update(id, dto); }
  @Delete(':id') @RequirePermission('delete', 'infra.servers') remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}

@Module({
  imports: [TypeOrmModule.forFeature([Server])],
  controllers: [ServersController],
  providers: [ServersService],
})
export class ServersModule {}
