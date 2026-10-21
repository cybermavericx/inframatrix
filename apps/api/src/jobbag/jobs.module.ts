import {
  Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Patch, Post, UseGuards,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { DeepPartial } from 'typeorm';
import { Job } from './entities/job.entity';
import { CrudService } from '../common/crud.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Injectable()
class JobsService extends CrudService<Job> {
  constructor(@InjectRepository(Job) repo: Repository<Job>) {
    super(repo, ['vendorService.vendor', 'client'], [], 'job');
  }

  /** auto-assign QUT#### unique id on create */
  async create(dto: DeepPartial<Job>): Promise<Job> {
    const job = await super.create(dto);
    if (!job.uniqueId) {
      job.uniqueId = 'QUT' + String(job.id).padStart(4, '0');
      await this.repo.save(job);
    }
    return job;
  }
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('jobbag/jobs')
class JobsController {
  constructor(private readonly service: JobsService) {}
  @Get() @RequirePermission('read', 'jobbag.jobs') list() { return this.service.list(); }
  @Get(':id') @RequirePermission('read', 'jobbag.jobs') get(@Param('id', ParseIntPipe) id: number) { return this.service.findOne(id); }
  @Post() @RequirePermission('create', 'jobbag.jobs') create(@Body() dto: DeepPartial<Job>) { return this.service.create(dto); }
  @Patch(':id') @RequirePermission('update', 'jobbag.jobs') update(@Param('id', ParseIntPipe) id: number, @Body() dto: DeepPartial<Job>) { return this.service.update(id, dto); }
  @Delete(':id') @RequirePermission('delete', 'jobbag.jobs') remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}

@Module({
  imports: [TypeOrmModule.forFeature([Job])],
  controllers: [JobsController],
  providers: [JobsService],
})
export class JobsModule {}
