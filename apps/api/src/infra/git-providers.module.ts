import {
  Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Patch, Post, UseGuards,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { DeepPartial } from 'typeorm';
import { GitProvider } from './entities/git-provider.entity';
import { CrudService } from '../common/crud.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

const RES = 'infra.git-providers';

@Injectable()
class GitProvidersService extends CrudService<GitProvider> {
  constructor(@InjectRepository(GitProvider) repo: Repository<GitProvider>) { super(repo, [], [], 'git_provider'); }
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('infra/git-providers')
class GitProvidersController {
  constructor(private readonly service: GitProvidersService) {}
  @Get() @RequirePermission('read', RES) list() { return this.service.list(); }
  @Get(':id') @RequirePermission('read', RES) get(@Param('id', ParseIntPipe) id: number) { return this.service.findOne(id); }
  @Post() @RequirePermission('create', RES) create(@Body() dto: DeepPartial<GitProvider>) { return this.service.create(dto); }
  @Patch(':id') @RequirePermission('update', RES) update(@Param('id', ParseIntPipe) id: number, @Body() dto: DeepPartial<GitProvider>) { return this.service.update(id, dto); }
  @Delete(':id') @RequirePermission('delete', RES) remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}

@Module({ imports: [TypeOrmModule.forFeature([GitProvider])], controllers: [GitProvidersController], providers: [GitProvidersService] })
export class GitProvidersModule {}
