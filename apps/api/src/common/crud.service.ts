import { BadRequestException, ConflictException } from '@nestjs/common';
import { DeepPartial, FindOptionsWhere, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { recordLifecycle, recordUpdate } from '../audit/audit.util';

/** A pair of date columns where `to` must be on/after `from` (e.g. amcFrom→amcTo). */
export type DateRange = { from: string; to: string; label?: string };

/** Generic CRUD service reused by every resource module. remove() is a HARD delete (see its own
 *  comment) — soft-delete (`deletedAt`) is used selectively by specific services that need it (e.g.
 *  Users, for email-reuse-on-recreate), not by this base class. */
export class CrudService<T extends { id: number }> {
  constructor(
    protected readonly repo: Repository<T>,
    protected readonly relations: string[] = [],
    /** date pairs validated on create/update so the API enforces "to >= from" too */
    protected readonly dateRanges: DateRange[] = [],
    /** when set (e.g. 'server'), create/update/delete are recorded to the change-log under this type */
    protected readonly auditType?: string,
  ) {}

  // Build TypeORM's nested relations object from dot-path strings: ['vendorService.vendor','client']
  // → { vendorService: { vendor: true }, client: true }. (String-array relations were removed in v1.)
  private rel() {
    const root: Record<string, unknown> = {};
    for (const path of this.relations) {
      const parts = path.split('.');
      let node = root;
      parts.forEach((p, i) => {
        if (i === parts.length - 1) {
          if (typeof node[p] !== 'object') node[p] = true;
        } else {
          if (typeof node[p] !== 'object' || node[p] === null) node[p] = {};
          node = node[p] as Record<string, unknown>;
        }
      });
    }
    return root;
  }

  /** Reject inverted date pairs ("to" earlier than "from"); mirrors the web form check. */
  protected assertDateRanges(record: Record<string, unknown>) {
    for (const r of this.dateRanges) {
      const from = record[r.from] as string | null | undefined;
      const to = record[r.to] as string | null | undefined;
      if (from && to && String(to) < String(from)) {
        throw new BadRequestException(`${r.label ?? r.to} cannot be earlier than ${r.from}.`);
      }
    }
  }

  list(): Promise<T[]> {
    return this.repo.find({ order: { id: 'DESC' } as never, relations: this.rel() as never });
  }

  findOne(id: number): Promise<T | null> {
    return this.repo.findOne({ where: { id } as FindOptionsWhere<T>, relations: this.rel() as never });
  }

  /** Map known MySQL constraint errors to clean 4xx responses instead of a raw 500. */
  private rethrowDbError(e: unknown): never {
    const err = e as { code?: string; driverError?: { code?: string }; message?: string };
    const code = err.code ?? err.driverError?.code;
    if (code === 'ER_DUP_ENTRY') {
      throw new ConflictException('A record with these unique values already exists.');
    }
    if (code === 'ER_BAD_NULL_ERROR' || code === 'ER_NO_DEFAULT_FOR_FIELD') {
      const col = /column '([^']+)'/i.exec(err.message ?? '')?.[1];
      throw new BadRequestException(col ? `The field "${col}" is required.` : 'A required field is missing.');
    }
    throw e;
  }

  /**
   * Drop empty (null/''/undefined) values for non-nullable columns that have a DB default, so the
   * default applies instead of forcing NULL into the column (which would 500). The web form sends
   * every blank field as null, so without this a blank "status" etc. breaks inserts.
   */
  private dropEmptyDefaulted(d: Record<string, unknown>) {
    for (const c of this.repo.metadata.columns) {
      const v = d[c.propertyName];
      if ((v === null || v === undefined || v === '') && !c.isNullable && c.default !== undefined) {
        delete d[c.propertyName];
      }
    }
  }

  /**
   * Drop keys that aren't a real entity column or relation, so a stray field on the payload
   * (e.g. a server-computed extra echoed back by the UI — publishState, the projects hosting summary)
   * never reaches TypeORM and 500s with EntityPropertyNotFoundError. Defensive for every resource.
   */
  private stripUnknown(d: Record<string, unknown>) {
    const allowed = new Set<string>();
    for (const c of this.repo.metadata.columns) allowed.add(c.propertyName);
    for (const r of this.repo.metadata.relations) allowed.add(r.propertyName);
    for (const k of Object.keys(d)) if (!allowed.has(k)) delete d[k];
  }

  async create(dto: DeepPartial<T>): Promise<T> {
    const d = dto as Record<string, unknown>;
    this.stripUnknown(d);
    this.assertDateRanges(d);
    this.dropEmptyDefaulted(d);
    // auto-assign a stable importUid (if the entity has one) so exports re-import idempotently
    if (!d.importUid && this.repo.metadata.columns.some((c) => c.propertyName === 'importUid')) {
      d.importUid = randomUUID();
    }
    let saved: T;
    try {
      saved = await this.repo.save(this.repo.create(dto));
    } catch (e) {
      this.rethrowDbError(e);
    }
    if (this.auditType) await recordLifecycle(this.repo as never, this.auditType, saved as Record<string, unknown>, 'created');
    return saved;
  }

  async update(id: number, dto: DeepPartial<T>): Promise<T | null> {
    const d = dto as Record<string, unknown>;
    this.stripUnknown(d);
    this.dropEmptyDefaulted(d);
    // Load the stored row when we need it: to validate a partial date PATCH and/or to diff for the
    // change-log. One fetch covers both.
    const existing = (this.dateRanges.length || this.auditType)
      ? await this.repo.findOne({ where: { id } as FindOptionsWhere<T> })
      : null;
    if (this.dateRanges.length) {
      this.assertDateRanges({ ...(existing as Record<string, unknown> ?? {}), ...d });
    }
    try {
      await this.repo.update(id, dto as never);
    } catch (e) {
      this.rethrowDbError(e);
    }
    if (this.auditType && existing) {
      await recordUpdate(this.repo as never, this.auditType, id, existing as Record<string, unknown>, d);
    }
    return this.findOne(id);
  }

  async remove(id: number) {
    // HARD delete: the row is removed and DB foreign keys cascade (e.g. project → environments →
    // integrations) or SET NULL as declared. Integer ids are never reused — MySQL persists the
    // AUTO_INCREMENT counter across deletes/restarts — so no tombstone is needed to keep ids unique.
    if (this.auditType) {
      const existing = await this.repo.findOne({ where: { id } as FindOptionsWhere<T> });
      if (existing) await recordLifecycle(this.repo as never, this.auditType, existing as Record<string, unknown>, 'deleted');
    }
    await this.repo.delete(id);
    return { success: true };
  }
}
