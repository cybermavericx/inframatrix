import {
  Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Patch, Post, UseGuards,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { DeepPartial } from 'typeorm';
import { Integration } from './entities/integration.entity';
import { IntegrationType } from './entities/integration-type.entity';
import { IntegrationFieldOption } from './entities/integration-field-option.entity';
import { IntegrationFieldValue } from './entities/integration-field-value.entity';
import { assertChangedValues, syncIntegrationValues, valueStatusFor } from './field-catalog';
import { CrudService } from '../common/crud.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

const RES = 'infra.integrations';
const RELATIONS = ['environment', 'integrationType', 'account'];

@Injectable()
class IntegrationsService extends CrudService<Integration> {
  constructor(@InjectRepository(Integration) repo: Repository<Integration>) {
    super(repo, RELATIONS, [], 'integration');
  }

  /** List rows also carry `fieldStatus` ({ key: { status, level } }) so the UI can mark outdated/EOL
   *  and line-only values. Read-only extra: stripUnknown drops it if a client echoes it back. */
  override async list() {
    const rows = await super.list();
    const status = await valueStatusFor(this.repo.manager, rows.map((r) => r.id));
    return rows.map((r) => Object.assign(r, { fieldStatus: status[r.id] ?? {} }));
  }

  /**
   * Same create/update as before, plus (in ONE transaction, so the JSON and its searchable copy can't
   * disagree): the save-time rules on CHANGED custom-field values, and the value rows rebuilt from the
   * saved JSON. fieldValues JSON is still written exactly as before (dual-write).
   */
  override create(dto: DeepPartial<Integration>) {
    return this.repo.manager.transaction(async (m) => {
      const d = dto as Partial<Integration>;
      if (d.fieldValues && d.integrationTypeId) {
        assertChangedValues(await m.findOne(IntegrationType, { where: { id: d.integrationTypeId } }), d.fieldValues, null);
      }
      const saved = await new CrudService(m.getRepository(Integration), RELATIONS, [], 'integration').create(dto);
      await syncIntegrationValues(m, [saved.id]);
      return saved;
    });
  }

  override update(id: number, dto: DeepPartial<Integration>) {
    return this.repo.manager.transaction(async (m) => {
      const d = dto as Partial<Integration>;
      const stored = await m.findOne(Integration, { where: { id } });
      if (stored && ('fieldValues' in d || 'integrationTypeId' in d)) {
        const typeId = d.integrationTypeId !== undefined ? d.integrationTypeId : stored.integrationTypeId;
        const next = 'fieldValues' in d ? d.fieldValues : stored.fieldValues;
        // compare against what is stored for the SAME type; a type switch makes every value new
        const before = typeId === stored.integrationTypeId ? stored.fieldValues : null;
        if (typeId) assertChangedValues(await m.findOne(IntegrationType, { where: { id: typeId } }), next, before);
      }
      const out = await new CrudService(m.getRepository(Integration), RELATIONS, [], 'integration').update(id, dto);
      await syncIntegrationValues(m, [id]);
      return out;
    });
  }
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('infra/integrations')
class IntegrationsController {
  constructor(private readonly service: IntegrationsService) {}
  @Get() @RequirePermission('read', RES) list() { return this.service.list(); }
  @Get(':id') @RequirePermission('read', RES) get(@Param('id', ParseIntPipe) id: number) { return this.service.findOne(id); }
  @Post() @RequirePermission('create', RES) create(@Body() dto: DeepPartial<Integration>) { return this.service.create(dto); }
  @Patch(':id') @RequirePermission('update', RES) update(@Param('id', ParseIntPipe) id: number, @Body() dto: DeepPartial<Integration>) { return this.service.update(id, dto); }
  @Delete(':id') @RequirePermission('delete', RES) remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}

@Module({ imports: [TypeOrmModule.forFeature([Integration, IntegrationType, IntegrationFieldOption, IntegrationFieldValue])], controllers: [IntegrationsController], providers: [IntegrationsService] })
export class IntegrationsModule {}
