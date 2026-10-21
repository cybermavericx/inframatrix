import type { EntityManager, ObjectLiteral, Repository } from 'typeorm';
import { currentUser } from '../common/request-context';
import { AuditLog } from './entities/audit-log.entity';
import { Environment } from '../infra/entities/environment.entity';
import { Project } from '../infra/entities/project.entity';

/** 'serverName' / 'amc_to' → 'Server name' / 'Amc to' — a readable label for the change-log. */
export function humanizeField(name: string): string {
  const spaced = name
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Render a column value for the change-log as a short string ('' for null/empty, ISO for dates). */
export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** True when two column values are equal for change-detection (null/''/undefined all "empty"). */
export function valuesEqual(a: unknown, b: unknown): boolean {
  return formatValue(a) === formatValue(b);
}

/** Build an AuditLog row stamped with the current request's author. */
export function auditRow(entityType: string, entityId: number, partial: Partial<AuditLog>): Partial<AuditLog> {
  const { userId, userName } = currentUser();
  return { entityType, entityId, authorId: userId ?? null, authorName: userName ?? null, ...partial };
}

/** Append rows to the change-log. Best-effort by design: a logging failure must never break the real
 *  create/update/delete that triggered it, so it is swallowed. */
export async function insertAudit(manager: EntityManager, rows: Partial<AuditLog>[]): Promise<void> {
  if (!rows.length) return;
  try {
    await manager.getRepository(AuditLog).insert(rows);
  } catch {
    /* change-log is non-critical — ignore */
  }
}

/** Columns that should never appear as a tracked change. */
const AUDIT_SKIP = new Set(['id', 'createdAt', 'updatedAt', 'deletedAt', 'createdBy', 'updatedBy', 'importUid']);

// Same preference order the export/import engine uses to pick "the" human label column of a record.
const LABEL_PREFERENCE = ['name', 'serverName', 'accountName', 'vendorName', 'serviceName', 'title', 'url', 'email'];

export function pickLabelColumn(meta: { columns: { propertyName: string }[] }): string | null {
  const names = meta.columns.map((c) => c.propertyName);
  for (const p of LABEL_PREFERENCE) if (names.includes(p)) return p;
  return names.find((n) => /name$/i.test(n)) ?? null;
}

/** A short human label for a record ("Hostinger", "Acme Ltd", ...), falling back to "#id". */
export function recordLabel(repo: Repository<ObjectLiteral>, row: Record<string, unknown> | null | undefined): string {
  if (!row) return '';
  const col = pickLabelColumn(repo.metadata);
  const v = col ? row[col] : null;
  return v != null && String(v).trim() !== '' ? String(v) : `#${row.id}`;
}

/**
 * Per-field change rows for an update. A foreign-key column (serverId, pocUserId, ...) is logged by
 * the related record's NAME instead of its raw id — "Hostinger → vm-tw-dxb-lnx02", not "13 → 20" —
 * and labelled by the relation ("Server"), like Odoo's chatter does.
 */
export async function buildChangeRows(
  repo: Repository<ObjectLiteral>,
  entityType: string,
  id: number,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<Partial<AuditLog>[]> {
  const fkByColumn = new Map<string, (typeof repo.metadata.relations)[number]>();
  for (const rel of repo.metadata.relations) {
    const jc = rel.joinColumns?.[0];
    if (!jc) continue;
    const col = repo.metadata.columns.find((c) => c.databaseName === jc.databaseName && c.propertyName !== rel.propertyName);
    if (col) fkByColumn.set(col.propertyName, rel);
  }
  const cache = new Map<string, string>();
  const nameOf = async (rel: (typeof repo.metadata.relations)[number], value: unknown): Promise<string> => {
    if (value === null || value === undefined || value === '') return '';
    const key = `${rel.propertyName}:${value}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const target = repo.manager.getRepository(rel.inverseEntityMetadata.target);
    const row = (await target.findOne({ where: { id: value } as never, withDeleted: true })) as Record<string, unknown> | null;
    const label = row ? recordLabel(target, row) : `#${value}`;
    cache.set(key, label);
    return label;
  };

  const relationNames = new Set(repo.metadata.relations.map((r) => r.propertyName));
  const rows: Partial<AuditLog>[] = [];
  for (const k of Object.keys(after)) {
    if (AUDIT_SKIP.has(k) || relationNames.has(k) || valuesEqual(before[k], after[k])) continue;
    const rel = fkByColumn.get(k);
    rows.push(auditRow(entityType, id, {
      action: 'updated',
      field: k,
      fieldLabel: rel ? humanizeField(rel.propertyName) : humanizeField(k),
      oldValue: rel ? await nameOf(rel, before[k]) : formatValue(before[k]),
      newValue: rel ? await nameOf(rel, after[k]) : formatValue(after[k]),
    }));
  }
  return rows;
}

/** Where a record's changes are shown/labelled. `label` is the readable name stored on every row (so the
 *  global Activity Log can name a record even after it is deleted); `target` — for children (an
 *  environment, an integration) — is the parent whose timeline should ALSO carry the change, so a
 *  Project's Activity tells the whole story. Mirrored as extra rows under the parent: no joins on read. */
export interface AuditContext {
  label: string;
  target: { entityType: string; entityId: number; context: string; label: string } | null;
}

export async function auditContext(
  repo: Repository<ObjectLiteral>,
  entityType: string,
  record: Record<string, unknown>,
): Promise<AuditContext> {
  const manager = repo.manager;
  const projectName = async (projectId: unknown) => {
    const p = (await manager.getRepository(Project).findOne({ where: { id: projectId } as never, withDeleted: true })) as Record<string, unknown> | null;
    return p?.name ? String(p.name) : `#${projectId}`;
  };
  if (entityType === 'environment' && record.projectId) {
    const pname = await projectName(record.projectId);
    const env = `${record.type ?? ''} environment`.trim();
    return { label: `${pname} · ${record.type ?? 'environment'}`, target: { entityType: 'project', entityId: Number(record.projectId), context: env, label: pname } };
  }
  if (entityType === 'integration' && record.environmentId) {
    const env = (await manager.getRepository(Environment).findOne({ where: { id: record.environmentId } as never })) as Record<string, unknown> | null;
    if (env?.projectId) {
      const pname = await projectName(env.projectId);
      const ctx = `${env.type ?? ''} environment · integration`.trim();
      return { label: `${pname} · ${env.type ?? ''} integration`, target: { entityType: 'project', entityId: Number(env.projectId), context: ctx, label: pname } };
    }
  }
  return { label: recordLabel(repo, record).slice(0, 255), target: null };
}

/** Copy rows onto the parent's timeline, prefixed with which child they came from. Flagged `mirror` so
 *  the global Activity Log (which lists the original rows) doesn't show the same change twice. */
export function mirrorRows(rows: Partial<AuditLog>[], target: NonNullable<AuditContext['target']>): Partial<AuditLog>[] {
  return rows.map((r) => ({
    ...r,
    entityType: target.entityType,
    entityId: target.entityId,
    entityLabel: target.label.slice(0, 255),
    mirror: true,
    fieldLabel: r.fieldLabel ? `${target.context} · ${r.fieldLabel}` : r.fieldLabel,
    message: r.message ? `${target.context} · ${r.message}` : r.message,
  }));
}

/** Log a field-level update (and mirror it to the parent's timeline). Used by CrudService and imports. */
export async function recordUpdate(
  repo: Repository<ObjectLiteral>,
  entityType: string,
  id: number,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<void> {
  try {
    const built = await buildChangeRows(repo, entityType, id, before, after);
    if (!built.length) return;
    const ctx = await auditContext(repo, entityType, { ...before, ...after });
    const rows = built.map((r) => ({ ...r, entityLabel: ctx.label }));
    await insertAudit(repo.manager, ctx.target ? [...rows, ...mirrorRows(rows, ctx.target)] : rows);
  } catch {
    /* change-log is non-critical */
  }
}

/** Log a record being created or deleted ("Created Hostinger"), mirrored to the parent too. */
export async function recordLifecycle(
  repo: Repository<ObjectLiteral>,
  entityType: string,
  record: Record<string, unknown>,
  action: 'created' | 'deleted',
): Promise<void> {
  try {
    const ctx = await auditContext(repo, entityType, record);
    const verb = action === 'created' ? 'Created' : 'Deleted';
    const rows = [auditRow(entityType, Number(record.id), { action, entityLabel: ctx.label, message: `${verb} ${ctx.label}`.slice(0, 255) })];
    await insertAudit(repo.manager, ctx.target ? [...rows, ...mirrorRows(rows, ctx.target)] : rows);
  } catch {
    /* change-log is non-critical */
  }
}

/** audit entityType per resource key — lets code that doesn't extend CrudService (the Excel import)
 *  record changes under the same type the UI's Activity panel reads. */
export const AUDIT_TYPE_BY_RESOURCE: Record<string, string> = {
  'core.users': 'user',
  'infra.servers': 'server',
  'infra.projects': 'project',
  'infra.environments': 'environment',
  'infra.git-providers': 'git_provider',
  'infra.integration-types': 'integration_type',
  'infra.accounts': 'account',
  'infra.integrations': 'integration',
  'jobbag.clients': 'client',
  'jobbag.vendors': 'vendor',
  'jobbag.vendor-services': 'vendor_service',
  'jobbag.jobs': 'job',
  'jobbag.payments': 'payment',
};
