import {
  BadRequestException, Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Patch, Post, UseGuards,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { DeepPartial } from 'typeorm';
import { IntegrationType } from './entities/integration-type.entity';
import { Integration } from './entities/integration.entity';
import { findForbiddenField } from './integration-fields.util';
import { CrudService } from '../common/crud.service';
import { blockedBy, type Blocker } from '../common/blocked';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

const RES = 'infra.integration-types';

@Injectable()
class IntegrationTypesService extends CrudService<IntegrationType> {
  constructor(
    @InjectRepository(IntegrationType) repo: Repository<IntegrationType>,
    @InjectRepository(Integration) private readonly intRepo: Repository<Integration>,
  ) { super(repo, [], [], 'integration_type'); }

  /** Never let a custom field be defined to hold a password/secret — that must stay outside the app. */
  private assertNoForbiddenFields(dto: DeepPartial<IntegrationType>) {
    const offender = findForbiddenField(dto.fields as IntegrationType['fields']);
    if (offender) {
      throw new BadRequestException(`Field "${offender}" looks like it stores a password/secret — those must never be saved here.`);
    }
  }

  override create(dto: DeepPartial<IntegrationType>) {
    this.assertNoForbiddenFields(dto);
    return super.create(dto);
  }

  override update(id: number, dto: DeepPartial<IntegrationType>) {
    this.assertNoForbiddenFields(dto);
    return super.update(id, dto);
  }

  /**
   * Block delete while integrations of this type still exist. Integration.integrationType is
   * onDelete: CASCADE, so without this guard, deleting what looks like an entry in a settings/taxonomy
   * list ("Integration Types") would silently, permanently wipe out every real integration of that
   * type across every project in the system — no count, no warning, just a generic confirm() dialog.
   */
  override async remove(id: number) {
    const uses = await this.intRepo.find({ where: { integrationTypeId: id }, relations: { environment: true }, take: 200 });
    if (uses.length) {
      const blockers: Blocker[] = uses.map((i) => ({
        resource: 'infra.integrations',
        id: i.id,
        label: [i.keyName, i.value].filter(Boolean).join(': ') || `Integration #${i.id}`,
      }));
      throw blockedBy('integration type', blockers, 'Remove or reassign these integrations first, then delete the type.');
    }
    return super.remove(id);
  }
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('infra/integration-types')
class IntegrationTypesController {
  constructor(private readonly service: IntegrationTypesService) {}
  @Get() @RequirePermission('read', RES) list() { return this.service.list(); }
  @Get(':id') @RequirePermission('read', RES) get(@Param('id', ParseIntPipe) id: number) { return this.service.findOne(id); }
  @Post() @RequirePermission('create', RES) create(@Body() dto: DeepPartial<IntegrationType>) { return this.service.create(dto); }
  @Patch(':id') @RequirePermission('update', RES) update(@Param('id', ParseIntPipe) id: number, @Body() dto: DeepPartial<IntegrationType>) { return this.service.update(id, dto); }
  @Delete(':id') @RequirePermission('delete', RES) remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}

@Module({ imports: [TypeOrmModule.forFeature([IntegrationType, Integration])], controllers: [IntegrationTypesController], providers: [IntegrationTypesService] })
export class IntegrationTypesModule {}
