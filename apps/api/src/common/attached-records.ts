import { In } from 'typeorm';
import type { EntityManager, ObjectLiteral, Repository } from 'typeorm';
import { Note } from '../jobbag/entities/note.entity';
import { Reminder } from '../jobbag/entities/reminder.entity';
import { Environment } from '../infra/entities/environment.entity';
import { Integration } from '../infra/entities/integration.entity';
import {
  auditContext,
  auditRow,
  formatValue,
  insertAudit,
  mirrorRows,
} from '../audit/audit.util';
import type { AuditLog } from '../audit/entities/audit-log.entity';

/** A record that notes/reminders can point at (parentType + parentId), with what labels it in the change-log. */
interface Parent {
  type: string;
  repo: Repository<ObjectLiteral>;
  row: Record<string, unknown>;
}

/**
 * The record being deleted plus the children the database deletes with it. These follow the
 * `onDelete: 'CASCADE'` relations in the entities: environment.project, integration.environment and
 * integration.integrationType. Soft-deleted children are included because the cascade removes them too.
 */
async function withCascadedChildren(
  m: EntityManager,
  top: Parent,
): Promise<Parent[]> {
  const out: Parent[] = [top];
  const envRepo = m.getRepository(Environment);
  const intRepo = m.getRepository(Integration);
  const id = Number(top.row.id);
  let envIds: number[] = [];
  if (top.type === 'project') {
    const envs = await envRepo.find({
      where: { projectId: id },
      withDeleted: true,
    });
    for (const e of envs)
      out.push({
        type: 'environment',
        repo: envRepo,
        row: e as never,
      });
    envIds = envs.map((e) => e.id);
  } else if (top.type === 'environment') {
    envIds = [id];
  }
  const ints = envIds.length
    ? await intRepo.find({
        where: { environmentId: In(envIds) },
        withDeleted: true,
      })
    : top.type === 'integration_type'
      ? await intRepo.find({
          where: { integrationTypeId: id },
          withDeleted: true,
        })
      : [];
  for (const i of ints)
    out.push({ type: 'integration', repo: intRepo, row: i as never });
  return out;
}

/** Change-log rows for one parent's removed notes and reminders, mirrored to its project like other changes. */
async function auditRows(
  parent: Parent,
  notes: Note[],
  reminders: Reminder[],
): Promise<Partial<AuditLog>[]> {
  const id = Number(parent.row.id);
  const rows = [
    // Same shape as deleting a single note, so the Activity timeline shows "Note deleted: <text> → —".
    ...notes.map((n) =>
      auditRow(parent.type, id, {
        action: 'updated',
        field: 'note',
        fieldLabel: 'Note deleted',
        oldValue: n.body ?? '',
        newValue: '',
      }),
    ),
    ...reminders.map((r) =>
      auditRow(parent.type, id, {
        action: 'updated',
        field: 'reminder',
        fieldLabel: 'Reminder deleted',
        oldValue: [r.title, r.content, formatValue(r.scheduledDateTime)]
          .filter(Boolean)
          .join(' · '),
        newValue: '',
      }),
    ),
  ];
  const ctx = await auditContext(parent.repo, parent.type, parent.row);
  const labelled = rows.map((r) => ({ ...r, entityLabel: ctx.label }));
  return ctx.target
    ? [...labelled, ...mirrorRows(labelled, ctx.target)]
    : labelled;
}

/**
 * Called inside the same transaction that hard-deletes `row` (see CrudService.remove). Deletes the notes
 * and the WAITING (not yet fired) reminders attached to the record and to the children the database
 * cascades with it, so they don't stay behind pointing at an id that no longer exists. Each removed
 * note's text (and each reminder's title/content/date) is written to the change-log first.
 * Reminders past WAITING (DUE, PENDING_RESOLVED, RESOLVED, CANCELLED) are kept as history.
 */
export async function removeAttached(
  m: EntityManager,
  type: string,
  repo: Repository<ObjectLiteral>,
  row: Record<string, unknown>,
): Promise<void> {
  const parents = await withCascadedChildren(m, { type, repo, row });
  const noteRepo = m.getRepository(Note);
  const remRepo = m.getRepository(Reminder);
  const audit: Partial<AuditLog>[] = [];
  const noteIds: number[] = [];
  const remIds: number[] = [];
  for (const p of parents) {
    const where = { parentType: p.type, parentId: Number(p.row.id) };
    const notes = await noteRepo.find({
      where,
      order: { id: 'ASC' },
      withDeleted: true,
    });
    const reminders = await remRepo.find({
      where: { ...where, status: 'WAITING' },
      order: { id: 'ASC' },
      withDeleted: true,
    });
    if (!notes.length && !reminders.length) continue;
    audit.push(...(await auditRows(p, notes, reminders)));
    noteIds.push(...notes.map((n) => n.id));
    remIds.push(...reminders.map((r) => r.id));
  }
  await insertAudit(m, audit);
  if (noteIds.length) await noteRepo.delete({ id: In(noteIds) });
  if (remIds.length) await remRepo.delete({ id: In(remIds) });
}
