import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { In, type DataSource, type EntityManager, type EntityMetadata, type ObjectLiteral } from 'typeorm';
import type { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';
import type { AppAbility } from '../common/casl/ability.factory';
import { RESOURCE_ENTITIES, RESOURCE_ENUMS } from './registry';
import { canReadEntity } from './entity-access';
import { kindOf, SPECIAL } from './search';
import { User } from '../users/entities/user.entity';
import { ModuleEntity } from '../rbac/entities/module.entity';
import { GroupEntity } from '../rbac/entities/group.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { UsersService } from '../users/users.service';
import { Server } from '../infra/entities/server.entity';
import { Project } from '../infra/entities/project.entity';
import { Environment } from '../infra/entities/environment.entity';
import { Integration } from '../infra/entities/integration.entity';
import { IntegrationType } from '../infra/entities/integration-type.entity';
import { Account } from '../infra/entities/account.entity';
import { GitProvider } from '../infra/entities/git-provider.entity';
import { Client } from '../jobbag/entities/client.entity';
import { Vendor } from '../jobbag/entities/vendor.entity';
import { VendorService } from '../jobbag/entities/vendor-service.entity';
import { Job } from '../jobbag/entities/job.entity';
import { Payment } from '../jobbag/entities/payment.entity';
import { ServersService } from '../infra/servers.module';
import { ProjectsService } from '../infra/projects.module';
import { EnvironmentsService } from '../infra/environments.module';
import { IntegrationsService } from '../infra/integrations.module';
import { IntegrationTypesService } from '../infra/integration-types.module';
import { AccountsService } from '../infra/accounts.module';
import { GitProvidersService } from '../infra/git-providers.module';
import { ClientsService } from '../jobbag/clients.module';
import { VendorsService } from '../jobbag/vendors.module';
import { VendorServicesService } from '../jobbag/vendor-services.module';
import { JobsService } from '../jobbag/jobs.module';
import { PaymentsService } from '../jobbag/payments.module';
import { checkChangedValues, VALUE_MAX } from '../infra/field-catalog';

/**
 * Mass edit (phase 4): set ONE field to ONE value on up to MAX_IDS records of one resource.
 *
 *   POST /data/:resource/mass-edit  { ids, path, value, dryRun }
 *
 * - Each record is written through that resource's OWN service (the same update the edit form uses —
 *   its date-range checks, the technology-catalog rules, the change-log), built on one transaction's
 *   manager, so the whole batch commits or nothing does: one failing record rolls every record back.
 * - Up front, before anything is written: the field must be an editable column (never ids, timestamps,
 *   import keys, secrets, JSON, or a unique column across several records), the value must fit the
 *   column (type, length, required, the resource's dropdown list, an existing linked record), and the
 *   user needs update on the resource for every record (permissions in this app are per resource, so
 *   "per record" = the same resource check for each record + the record must exist). Any problem → the
 *   whole request is refused: there is never a partial write.
 * - dryRun runs every check and reports what would change, writing nothing.
 * - Supported: resources whose update writes the Activity log (one entry per changed record).
 *   Environments also take `cf:<typeId>:<fieldKey>` — the value of that custom field on the
 *   environment's integration of that type (example: set PHP to 8.3.36 on every selected hosting).
 */

export const MAX_IDS = 500;
type Updater = { update(id: number, dto: Record<string, unknown>): Promise<unknown> };
const R = (m: EntityManager, e: new () => object) => m.getRepository(e) as never;

/** resource → its real service, bound to the transaction's manager. */
const SERVICES: Record<string, (m: EntityManager) => Updater> = {
  'infra.servers': (m) => new ServersService(R(m, Server)),
  'infra.projects': (m) => new ProjectsService(R(m, Project), R(m, Environment), R(m, Integration), R(m, Server), R(m, User)),
  'infra.environments': (m) => new EnvironmentsService(R(m, Environment)),
  'infra.integrations': (m) => new IntegrationsService(R(m, Integration)),
  'infra.integration-types': (m) => new IntegrationTypesService(R(m, IntegrationType), R(m, Integration)),
  'infra.accounts': (m) => new AccountsService(R(m, Account)),
  'infra.git-providers': (m) => new GitProvidersService(R(m, GitProvider)),
  'jobbag.clients': (m) => new ClientsService(R(m, Client), R(m, Payment)),
  'jobbag.vendors': (m) => new VendorsService(R(m, Vendor), R(m, VendorService), R(m, Payment)),
  'jobbag.vendor-services': (m) => new VendorServicesService(R(m, VendorService), R(m, Payment)),
  'jobbag.jobs': (m) => new JobsService(R(m, Job)),
  'jobbag.payments': (m) => new PaymentsService(R(m, Payment)),
  'core.users': (m) => {
    const s = new UsersService(R(m, User), R(m, ModuleEntity), R(m, GroupEntity), R(m, RefreshToken));
    return { update: (id, dto) => s.update(id, dto as never) };
  },
};
/** Users: only these, never name/email/password/MFA secrets. */
const USER_FIELDS = new Set(['status', 'mfaRequired']);
const NEVER = new Set(['id', 'createdAt', 'updatedAt', 'deletedAt', 'createdBy', 'updatedBy', 'importUid']);

export const massEditable = (resource: string) => resource in SERVICES;

type Invalid = { id: number; message: string };
type Change = { id: number; from: unknown; to: unknown };
type Plan = {
  label: string;
  changes: Change[];
  unchanged: number[];
  missing: number[];
  invalid: Invalid[];
  /** the write for one changed record (inside the transaction) */
  write: (m: EntityManager, id: number) => Promise<void>;
};

const bad = (msg: string): never => { throw new BadRequestException(msg); };
const asText = (v: unknown) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v)).trim();

export class MassEdit {
  constructor(private readonly ds: DataSource, private readonly ability: AppAbility) {}

  async run(resource: string, body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) bad('Expected a JSON object.');
    const b = body as Record<string, unknown>;
    for (const k of Object.keys(b)) if (!['ids', 'path', 'value', 'dryRun'].includes(k)) bad(`Unknown key: ${k}`);
    if (!massEditable(resource)) bad('Mass edit is not available for this list.');
    if (!this.ability.can('update', resource)) throw new ForbiddenException();
    const ids = this.ids(b.ids);
    if (typeof b.path !== 'string' || !b.path) bad('Choose a field.');
    if (!('value' in b)) bad('Give a value (null to clear).');
    const dryRun = b.dryRun === true;

    const plan = await this.ds.transaction(async (m) => {
      const p = await this.plan(m, resource, ids, b.path as string, b.value);
      // per record: same permission for each, and the record must exist and be checked
      if (dryRun || p.missing.length || p.invalid.length) return p;
      for (const c of p.changes) {
        if (!this.ability.can('update', resource)) throw new ForbiddenException();
        try {
          await p.write(m, c.id);
        } catch (e) {
          const msg = (e as { response?: { message?: unknown }; message?: string }).response?.message ?? (e as Error).message;
          // throwing rolls the transaction back: no record is changed
          throw new BadRequestException(`Record #${c.id}: ${Array.isArray(msg) ? msg.join(', ') : String(msg)} — nothing was changed.`);
        }
      }
      return p;
    });

    const report = {
      field: plan.label,
      total: ids.length,
      changing: plan.changes.length,
      unchanged: plan.unchanged.length,
      missing: plan.missing,
      invalid: plan.invalid.slice(0, 50),
      sample: plan.changes.slice(0, 10),
    };
    if (dryRun) return { dryRun: true, ...report };
    if (plan.missing.length || plan.invalid.length) {
      throw new BadRequestException({ message: 'Nothing was changed: some records can\'t take this value.', ...report });
    }
    return { dryRun: false, updated: plan.changes.length, ...report };
  }

  private ids(v: unknown): number[] {
    if (!Array.isArray(v) || !v.length) bad('Select at least one record.');
    const arr = v as unknown[];
    if (arr.length > MAX_IDS) bad(`At most ${MAX_IDS} records at once.`);
    if (!arr.every((x) => Number.isInteger(x) && (x as number) > 0)) bad('ids must be record ids.');
    return [...new Set(arr as number[])];
  }

  private async plan(m: EntityManager, resource: string, ids: number[], path: string, value: unknown): Promise<Plan> {
    if (path.startsWith('cf:')) {
      if (resource !== 'infra.environments') bad('Custom fields can only be mass-edited on environments.');
      return this.planCustomField(m, ids, path, value);
    }
    const meta = m.getRepository(RESOURCE_ENTITIES[resource]).metadata;
    const col = this.editableColumn(resource, meta, path, ids.length);
    const next = await this.normalize(m, resource, meta, col, value);
    const rows: ObjectLiteral[] = await m.getRepository(meta.target).find({ where: { id: In(ids) } as never });
    const byId = new Map(rows.map((r) => [Number(r.id), r]));
    const p: Plan = {
      label: this.label(path), changes: [], unchanged: [], missing: [], invalid: [],
      write: async (tm, id) => { await SERVICES[resource](tm).update(id, { [col.propertyName]: next }); },
    };
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) { p.missing.push(id); continue; }
      const from = row[col.propertyName];
      if (asText(from) === asText(next)) p.unchanged.push(id);
      else p.changes.push({ id, from: from ?? null, to: next });
    }
    return p;
  }

  /** The column behind `path` if it may be mass-edited; else a 400 saying why. */
  private editableColumn(resource: string, meta: EntityMetadata, path: string, count: number): ColumnMetadata {
    if (path.includes('.')) bad('Only a field of the record itself can be mass-edited.');
    if (meta.relations.some((r) => r.propertyName === path)) bad(`${path} is a relation — choose its id field.`);
    const col = meta.columns.find((c) => c.propertyName === path);
    if (!col) return bad(`Unknown field: ${path}`);
    const readOnly = NEVER.has(path) || col.isPrimary || col.isGenerated || col.isSelect === false
      || col.isCreateDate || col.isUpdateDate || col.isDeleteDate || col.isVersion || col.isVirtual
      || (resource === 'core.users' && !USER_FIELDS.has(path));
    if (readOnly) bad(`${this.label(path)} is read-only and can't be mass-edited.`);
    if (!kindOf(col)) bad(`${this.label(path)} can't be mass-edited.`);
    const unique = meta.uniques.some((u) => u.columns.length === 1 && u.columns[0] === col)
      || meta.indices.some((i) => i.isUnique && i.columns.length === 1 && i.columns[0] === col);
    if (unique && count > 1) bad(`${this.label(path)} must be unique — it can't be set to one value on several records.`);
    return col;
  }

  /** Check and convert the value for the column (type, length, required, dropdown list, linked record). */
  private async normalize(m: EntityManager, resource: string, meta: EntityMetadata, col: ColumnMetadata, value: unknown): Promise<unknown> {
    const label = this.label(col.propertyName);
    const empty = value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
    if (empty) {
      if (!col.isNullable) bad(`${label} is required.`);
      return null;
    }
    const rel = meta.manyToOneRelations.find((r) => r.joinColumns.some((j) => j.databaseName === col.databaseName));
    if (rel) {
      const id = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
      if (!Number.isInteger(id) || (id as number) <= 0) bad(`${label}: choose a record.`);
      const target = rel.inverseEntityMetadata.target;
      if (!canReadEntity(this.ability, target)) throw new ForbiddenException();
      const exists = await m.getRepository(target).exists({ where: { id } as never });
      if (!exists) bad(`${label}: that record doesn't exist.`);
      return id;
    }
    const list = RESOURCE_ENUMS[resource]?.[col.propertyName];
    switch (kindOf(col)) {
      case 'string': {
        if (typeof value !== 'string' && typeof value !== 'number') bad(`${label}: expected text.`);
        const s = String(value).trim();
        const max = Number(col.length) || (col.type === 'text' ? 65_535 : 255);
        if (s.length > max) bad(`${label}: at most ${max} characters.`);
        if (list && !list.includes(s)) bad(`${label} must be one of: ${list.join(', ')}.`);
        return s;
      }
      case 'number': {
        const n = typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : value;
        if (typeof n !== 'number' || !Number.isFinite(n)) bad(`${label}: expected a number.`);
        if (['int', 'integer', 'tinyint', 'smallint', 'mediumint', 'bigint'].includes(String(col.type)) && !Number.isInteger(n)) bad(`${label}: expected a whole number.`);
        return n;
      }
      case 'date': {
        const s = typeof value === 'string' ? value.trim() : '';
        if (col.type === 'date' ? !/^\d{4}-\d{2}-\d{2}$/.test(s) : Number.isNaN(Date.parse(s))) bad(`${label}: expected a date (YYYY-MM-DD).`);
        if (col.type === 'date' && Number.isNaN(Date.parse(s))) bad(`${label}: not a real date.`);
        return s;
      }
      case 'boolean':
        if (value === true || value === 'true') return true;
        if (value === false || value === 'false') return false;
        return bad(`${label}: expected true or false.`);
      default:
        return bad(`${label} can't be mass-edited.`);
    }
  }

  /** cf:<typeId>:<key> on environments → that field on each environment's integration of that type. */
  private async planCustomField(m: EntityManager, ids: number[], path: string, value: unknown): Promise<Plan> {
    if (!this.ability.can('update', 'infra.integrations') || !canReadEntity(this.ability, IntegrationType)) throw new ForbiddenException();
    const match = SPECIAL.exec(path);
    if (!match || match[1] !== 'cf') return bad('Invalid custom field path.');
    const type = await m.findOne(IntegrationType, { where: { id: Number(match[2]) } });
    const field = type?.behavior === 'custom_fields' ? type.fields?.find((f) => f?.key === match[3]) : undefined;
    if (!type || !field) return bad('Unknown custom field.');
    const label = `${type.name} › ${field.label || field.key}`;
    let next: string | null = null;
    if (value !== null && value !== undefined && !(typeof value === 'string' && value.trim() === '')) {
      if (typeof value !== 'string' && typeof value !== 'number') bad(`${label}: expected text.`);
      next = String(value).trim();
      if (next.length > VALUE_MAX) bad(`${label}: at most ${VALUE_MAX} characters.`);
    }
    const envs = await m.find(Environment, { where: { id: In(ids) }, select: { id: true } });
    const envIds = new Set(envs.map((e) => e.id));
    const ints = await m.find(Integration, { where: { environmentId: In(ids.length ? ids : [0]), integrationTypeId: type.id } });
    const byEnv = new Map<number, Integration[]>();
    for (const i of ints) byEnv.set(i.environmentId as number, [...(byEnv.get(i.environmentId as number) ?? []), i]);
    const intOf = new Map<number, Integration>();
    const p: Plan = {
      label, changes: [], unchanged: [], missing: [], invalid: [],
      write: async (tm, envId) => {
        const it = intOf.get(envId)!;
        const values = { ...(it.fieldValues ?? {}) } as Record<string, string>;
        if (next === null) delete values[field.key]; else values[field.key] = next;
        await SERVICES['infra.integrations'](tm).update(it.id, { fieldValues: values });
      },
    };
    for (const id of ids) {
      if (!envIds.has(id)) { p.missing.push(id); continue; }
      const list = byEnv.get(id) ?? [];
      if (list.length !== 1) {
        p.invalid.push({ id, message: list.length ? `has ${list.length} ${type.name} integrations — edit it from the project` : `has no ${type.name} integration` });
        continue;
      }
      const it = list[0];
      intOf.set(id, it);
      const stored = (it.fieldValues ?? {}) as Record<string, unknown>;
      const from = stored[field.key] ?? null;
      if (asText(from) === asText(next)) { p.unchanged.push(id); continue; }
      const errors = checkChangedValues(type, { ...stored, [field.key]: next ?? '' }, stored);
      if (errors.length) { p.invalid.push({ id, message: errors.join(' ') }); continue; }
      p.changes.push({ id, from, to: next });
    }
    return p;
  }

  private label(path: string) {
    return path.replace(/Id$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
  }
}
