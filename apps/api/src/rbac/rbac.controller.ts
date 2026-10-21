import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModuleEntity } from './entities/module.entity';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('rbac')
export class RbacController {
  constructor(
    @InjectRepository(ModuleEntity) private readonly modules: Repository<ModuleEntity>,
  ) {}

  /** modules -> apps -> groups, used by the admin create/edit user form */
  @Get('structure')
  structure() {
    return this.modules.find({
      relations: { apps: { groups: true } },
      order: { sort: 'ASC' },
    });
  }
}
