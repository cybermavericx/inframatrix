import {
  BadRequestException, Body, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, ParseIntPipe, Patch, Post, UseGuards,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { DeepPartial } from 'typeorm';
import { IntegrationType } from './entities/integration-type.entity';
import { Integration } from './entities/integration.entity';
import { IntegrationFieldOption, OPTION_STATUSES, type OptionStatus } from './entities/integration-field-option.entity';
import { IntegrationFieldValue } from './entities/integration-field-value.entity';
import { findForbiddenField } from './integration-fields.util';
import { assertOptionRemovalsAllowed, optionsWithUsage, syncTypeOptions } from './field-catalog';
import { CrudService } from '../common/crud.service';
import { blockedBy, type Blocker } from '../common/blocked';
import { auditRow, insertAudit } from '../audit/audit.util';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

const RES = 'infra.integration-types';
const KINDS = new Set(['text', 'version']);

@Injectable()
export class IntegrationTypesService extends CrudService<IntegrationType> {
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
    for (const f of (dto.fields as IntegrationType['fields']) ?? []) {
      if (f?.kind !== undefined && f.kind !== null && !KINDS.has(f.kind)) throw new BadRequestException(`Field "${f.label || f.key}": kind must be text or version.`);
    }
  }

  /** Create/update as before; in the same transaction the type's option rows (and the value rows of
   *  its integrations) are re-synced from the saved field list. Removing an option that values still
   *  use is refused (409) before anything is written. */
  override create(dto: DeepPartial<IntegrationType>) {
    this.assertNoForbiddenFields(dto);
    return this.repo.manager.transaction(async (m) => {
      const saved = await new CrudService(m.getRepository(IntegrationType), [], [], 'integration_type').create(dto);
      await syncTypeOptions(m, saved.id);
      return saved;
    });
  }

  override update(id: number, dto: DeepPartial<IntegrationType>) {
    this.assertNoForbiddenFields(dto);
    return this.repo.manager.transaction(async (m) => {
      const d = dto as Partial<IntegrationType>;
      if ('fields' in d || 'behavior' in d) {
        const stored = await m.findOne(IntegrationType, { where: { id } });
        if (stored) await assertOptionRemovalsAllowed(m, id, 'fields' in d ? d.fields : stored.fields, d.behavior ?? stored.behavior);
      }
      const out = await new CrudService(m.getRepository(IntegrationType), [], [], 'integration_type').update(id, dto);
      await syncTypeOptions(m, id);
      return out;
    });
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

  async options(typeId: number) {
    if (!(await this.repo.exists({ where: { id: typeId } }))) throw new NotFoundException();
    return optionsWithUsage(this.repo.manager, typeId);
  }

  /** Set one option's status (current | outdated | eol). Search results that use the status change
   *  immediately — nothing on any integration is edited. Recorded on the type's Activity. */
  async setOptionStatus(typeId: number, optionId: number, body: unknown) {
    const status = (body as { status?: unknown } | null)?.status;
    if (typeof status !== 'string' || !(OPTION_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException(`status must be one of: ${OPTION_STATUSES.join(', ')}.`);
    }
    const m = this.repo.manager;
    const option = await m.findOne(IntegrationFieldOption, { where: { id: optionId, integrationTypeId: typeId } });
    if (!option) throw new NotFoundException();
    if (option.status !== status) {
      await m.update(IntegrationFieldOption, option.id, { status: status as OptionStatus });
      const type = await this.repo.findOne({ where: { id: typeId } });
      const field = type?.fields?.find((f) => f.key === option.fieldKey);
      await insertAudit(m, [auditRow('integration_type', typeId, {
        action: 'updated', field: 'optionStatus', entityLabel: type?.name ?? null,
        fieldLabel: `${field?.label || option.fieldKey}: ${option.value}`.slice(0, 140),
        oldValue: option.status, newValue: status, message: null,
      })]);
    }
    return { ...option, status };
  }
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('infra/integration-types')
class IntegrationTypesController {
  constructor(private readonly service: IntegrationTypesService) {}
  @Get() @RequirePermission('read', RES) list() { return this.service.list(); }
  @Get(':id') @RequirePermission('read', RES) get(@Param('id', ParseIntPipe) id: number) { return this.service.findOne(id); }
  @Get(':id/options') @RequirePermission('read', RES) options(@Param('id', ParseIntPipe) id: number) { return this.service.options(id); }
  @Patch(':id/options/:optionId') @RequirePermission('update', RES)
  setOptionStatus(@Param('id', ParseIntPipe) id: number, @Param('optionId', ParseIntPipe) optionId: number, @Body() body: unknown) {
    return this.service.setOptionStatus(id, optionId, body);
  }
  @Post() @RequirePermission('create', RES) create(@Body() dto: DeepPartial<IntegrationType>) { return this.service.create(dto); }
  @Patch(':id') @RequirePermission('update', RES) update(@Param('id', ParseIntPipe) id: number, @Body() dto: DeepPartial<IntegrationType>) { return this.service.update(id, dto); }
  @Delete(':id') @RequirePermission('delete', RES) remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}

@Module({
  imports: [TypeOrmModule.forFeature([IntegrationType, Integration, IntegrationFieldOption, IntegrationFieldValue])],
  controllers: [IntegrationTypesController],
  providers: [IntegrationTypesService],
})
export class IntegrationTypesModule {}
