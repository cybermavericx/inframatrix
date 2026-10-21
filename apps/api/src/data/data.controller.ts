import {
  BadRequestException, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query, Res,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository, ObjectLiteral, In, FindOptionsRelations } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { RESOURCE_ENTITIES, RESOURCE_ENUMS } from './registry';
import { AUDIT_TYPE_BY_RESOURCE, recordLifecycle, recordUpdate } from '../audit/audit.util';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { buildAbility } from '../common/casl/ability.factory';
import type { AuthUser } from '../auth/auth.types';

type ImportResult = { created: number; updated: number; skipped: number; errors: string[] };
type ParsedRow = { row: number; data: Record<string, unknown> };
type PrependCol = { header: string; value: (r: Record<string, unknown>) => unknown };
type LinkSpec = { col: string; fk: string; map: Map<string, number>; required?: boolean };
/** One validated export field path, e.g. "environments.project.name" → hops=[environments(many),
 *  project(one)], ownField="name". Produced by DataController.walkFieldPath. */
type FieldPathWalk = { hops: { key: string; cardinality: 'one' | 'many'; label: string; labelField: string | null }[]; ownField: string; label: string };

/**
 * Export template seeding: for these resources, the export pre-fills one row per record of the
 * named relation that doesn't yet have a row — e.g. vendor-services lists every vendor so you can
 * fill in the service columns and re-import quickly (no retyping, no duplicate vendors).
 * Value is the relation's display header (see relationLinksFor → header).
 */
const EXPORT_TEMPLATE_FROM: Record<string, string> = {
  'jobbag.vendor-services': 'vendor',
};

@UseGuards(JwtAuthGuard)
@Controller('data')
export class DataController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
  ) {}

  private repoFor(resource: string): Repository<ObjectLiteral> {
    const entity = RESOURCE_ENTITIES[resource];
    if (!entity) throw new NotFoundException(`Unknown resource: ${resource}`);
    return this.dataSource.getRepository(entity);
  }

  private columns(repo: Repository<ObjectLiteral>): string[] {
    // exclude DB-managed audit columns so import never writes null into them
    const skip = new Set(['createdAt', 'updatedAt', 'deletedAt', 'createdBy', 'updatedBy']);
    // also exclude non-selectable secret columns (e.g. User.password is select:false) — never export
    // them, and never emit an empty header that would make re-import skip existing rows.
    const secret = new Set(repo.metadata.columns.filter((c) => c.isSelect === false).map((c) => c.propertyName));
    return repo.metadata.columns.map((c) => c.propertyName).filter((p) => !skip.has(p) && !secret.has(p));
  }

  private pickLabelCol(meta: { columns: { propertyName: string }[] }): string | null {
    const names = meta.columns.map((c) => c.propertyName);
    const prefer = ['name', 'serverName', 'accountName', 'vendorName', 'serviceName', 'title', 'url', 'email'];
    for (const p of prefer) if (names.includes(p)) return p;
    return names.find((n) => /name$/i.test(n)) ?? null;
  }

  /** id ⇄ key maps for a lookup column (e.g. users by email): toId for import, toLabel for export. */
  private async lookupMap(repo: Repository<ObjectLiteral>, keyCol: string) {
    const toId = new Map<string, number>();
    const toLabel = new Map<number, string>();
    for (const r of (await repo.find({ take: 5000 })) as Record<string, unknown>[]) {
      const id = r.id as number;
      const key = r[keyCol];
      if (key != null && String(key).trim() !== '') toId.set(String(key).trim().toLowerCase(), id);
      toLabel.set(id, key != null ? String(key) : '');
    }
    return { toId, toLabel };
  }

  /**
   * For each single-column relation whose FK is exported, derive a human "name" column:
   * the relation property name (e.g. 'vendor'), the FK property ('vendorId'), the target repo
   * and its label column ('vendorName'). Drives name-based export/import linking for EVERY resource.
   */
  private relationLinksFor(repo: Repository<ObjectLiteral>) {
    const exported = new Set(this.columns(repo));
    const out: { fkProp: string; header: string; targetRepo: Repository<ObjectLiteral>; labelCol: string }[] = [];
    const seen = new Set<string>();
    for (const rel of repo.metadata.relations) {
      if (!rel.joinColumns?.length) continue;
      const fkDbName = rel.joinColumns[0].databaseName;
      const fkCol = repo.metadata.columns.find((c) => c.databaseName === fkDbName && exported.has(c.propertyName));
      const fkProp = fkCol?.propertyName ?? rel.joinColumns[0].propertyName;
      if (!exported.has(fkProp) || seen.has(fkProp)) continue;
      const targetRepo = this.dataSource.getRepository(rel.inverseEntityMetadata.target);
      const labelCol = this.pickLabelCol(targetRepo.metadata);
      if (!labelCol) continue;
      seen.add(fkProp);
      out.push({ fkProp, header: rel.propertyName || fkProp.replace(/Id$/, ''), targetRepo, labelCol });
    }
    return out;
  }

  /** relationLinksFor + the id⇄name lookup maps loaded for each target. */
  private async buildLinks(repo: Repository<ObjectLiteral>) {
    const specs = this.relationLinksFor(repo);
    return Promise.all(specs.map(async (s) => ({ ...s, ...(await this.lookupMap(s.targetRepo, s.labelCol)) })));
  }

  private addDataSheet(
    wb: ExcelJS.Workbook,
    name: string,
    repo: Repository<ObjectLiteral>,
    rows: ObjectLiteral[],
    opts: { prepend?: PrependCol[]; exclude?: string[]; hidden?: string[] } = {},
  ) {
    const exclude = new Set(opts.exclude ?? []);
    const cols = this.columns(repo).filter((c) => !exclude.has(c));
    const prepend = opts.prepend ?? [];
    const hidden = new Set(opts.hidden ?? []);
    const ws = wb.addWorksheet(name);
    ws.columns = [...prepend.map((p) => p.header), ...cols].map((c) => ({ header: c, key: c, width: 20, hidden: hidden.has(c) }));
    for (const r of rows as Record<string, unknown>[]) {
      const out: Record<string, unknown> = {};
      for (const p of prepend) out[p.header] = p.value(r);
      for (const c of cols) { const v = r[c]; out[c] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v; }
      ws.addRow(out);
    }
    ws.getRow(1).font = { bold: true };
    return ws;
  }

  /** "Reference" worksheet: relation records as ID → label, plus dropdown allowed values. */
  private async addReferenceSheet(wb: ExcelJS.Workbook, entries: { resource: string; repo: Repository<ObjectLiteral> }[]) {
    const ref = wb.addWorksheet('Reference');
    ref.getColumn(1).width = 32;
    ref.getColumn(2).width = 44;
    const put = (a: unknown, b: unknown = '', bold = false) => {
      const row = ref.addRow([a as ExcelJS.CellValue, b as ExcelJS.CellValue]);
      if (bold) row.font = { bold: true };
    };
    const blank = () => ref.addRow([]);

    put('POSSIBLE VALUES — on the data sheet, fill the relation column (e.g. "vendor", "client") with one of these names', '', true);
    blank();

    const seen = new Set<string>();
    for (const { resource, repo } of entries) {
      const exported = new Set(this.columns(repo));
      for (const rel of repo.metadata.relations) {
        if (!rel.joinColumns?.length) continue;
        const fkDbName = rel.joinColumns[0].databaseName;
        const fkCol = repo.metadata.columns.find((c) => c.databaseName === fkDbName && exported.has(c.propertyName));
        const fkProp = fkCol?.propertyName ?? rel.joinColumns[0].propertyName;
        if (seen.has(fkProp)) continue;
        seen.add(fkProp);
        const targetRepo = this.dataSource.getRepository(rel.inverseEntityMetadata.target);
        const labelCol = this.pickLabelCol(targetRepo.metadata);
        const rows = await targetRepo.find({ take: 1000 });
        put(`${rel.propertyName || fkProp.replace(/Id$/, '')}  →  use one of these names:`, '', true);
        if (!rows.length) put('(none yet)');
        for (const row of rows) { const rec = row as Record<string, unknown>; put(labelCol ? rec[labelCol] : rec.id); }
        blank();
      }
      const enums = RESOURCE_ENUMS[resource];
      if (enums) {
        for (const [col, opts] of Object.entries(enums)) {
          if (seen.has('enum:' + col)) continue;
          seen.add('enum:' + col);
          put(`${col}  →  allowed values:`, '', true);
          for (const o of opts) put(o);
          blank();
        }
      }
    }
  }

  private async loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buffer as never); } catch {
      throw new BadRequestException('Could not read the file. Please upload a valid .xlsx (use Export to get the correct template).');
    }
    return wb;
  }

  /** Reads a worksheet into row objects keyed by header (coercing booleans, blanks → null). */
  private parseSheet(ws: ExcelJS.Worksheet, repo: Repository<ObjectLiteral>, extraCols: string[] = []): ParsedRow[] {
    const cols = new Set([...this.columns(repo), ...extraCols]);
    const boolCols = new Set(repo.metadata.columns.filter((c) => c.type === Boolean || c.type === 'boolean').map((c) => c.propertyName));
    const toBool = (v: unknown) => ['1', 'y', 'yes', 'true'].includes(String(v ?? '').trim().toLowerCase());
    const header: string[] = [];
    ws.getRow(1).eachCell((cell, col) => { header[col] = String(cell.value ?? '').trim(); });
    const out: ParsedRow[] = [];
    for (let i = 2; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      const obj: Record<string, unknown> = {};
      header.forEach((h, col) => {
        if (h && h !== 'id' && cols.has(h)) {
          let v: unknown = row.getCell(col).value;
          if (v === '' || v === undefined) v = null;
          if (boolCols.has(h)) v = toBool(v);
          if (h === 'importUid') v = this.extractImportUid(v);
          obj[h] = v;
        }
      });
      if (Object.keys(obj).filter((k) => obj[k] !== null).length === 0) continue;
      out.push({ row: i, data: obj });
    }
    return out;
  }

  /** Resolves human columns (name/email) to FK ids; clears the helper column afterwards. */
  private resolveLinks(rows: ParsedRow[], links: LinkSpec[], label: string): { rows: ParsedRow[]; errors: string[]; skipped: number } {
    const out: ParsedRow[] = [];
    const errors: string[] = [];
    let skipped = 0;
    outer: for (const item of rows) {
      for (const lnk of links) {
        const val = item.data[lnk.col];
        if (val != null && String(val).trim() !== '') {
          const id = lnk.map.get(String(val).trim().toLowerCase());
          if (id != null) {
            item.data[lnk.fk] = id;
          } else {
            // A provided value that matches no existing record blocks the row outright, regardless of
            // `required` — silently nulling the relation out instead would look like the edit worked
            // when it didn't (e.g. "User2" for a typo'd "user 2" would quietly clear the real POC).
            if (errors.length < 30) errors.push(`${label} row ${item.row}: ${lnk.col} "${String(val)}" not found`);
            skipped++;
            continue outer;
          }
        } else if (lnk.required) {
          // a required link (e.g. an environment's projectName) is blank → skip with a clear message,
          // rather than silently creating an orphaned record
          if (errors.length < 30) errors.push(`${label} row ${item.row}: ${lnk.col} is required (blank)`);
          skipped++;
          continue outer;
        }
        delete item.data[lnk.col];
      }
      out.push(item);
    }
    return { rows: out, errors, skipped };
  }

  /** Match-by-importUid/unique upsert of parsed rows into a repo (restores soft-deleted). */
  private async upsertRows(repo: Repository<ObjectLiteral>, parsed: ParsedRow[], label = 'Row '): Promise<ImportResult> {
    const cols = new Set(this.columns(repo));
    const hasUid = cols.has('importUid');
    const uniqueCols: string[] = [];
    for (const idx of repo.metadata.indices) if (idx.isUnique && idx.columns.length === 1) uniqueCols.push(idx.columns[0].propertyName);
    for (const uq of repo.metadata.uniques) if (uq.columns.length === 1) uniqueCols.push(uq.columns[0].propertyName);
    const matchCols = [...new Set(uniqueCols)].filter((c) => c !== 'importUid' && cols.has(c));
    const requiredCols = repo.metadata.columns
      .filter((c) => !c.isNullable && c.default === undefined && !c.isPrimary && !c.isGenerated && !c.isCreateDate && !c.isUpdateDate && !c.isDeleteDate)
      .map((c) => c.propertyName).filter((p) => cols.has(p));
    const isEmpty = (v: unknown) => v === null || v === undefined || v === '';
    // columns that are NOT NULL but have a DB default — a blank cell must fall back to the default,
    // not be forced to NULL (which would 500 the row, e.g. is_renewable, status).
    const defaultedCols = new Set(
      repo.metadata.columns.filter((c) => !c.isNullable && c.default !== undefined).map((c) => c.propertyName),
    );

    // which change-log timeline an imported row belongs on (undefined → this table isn't change-logged)
    const resourceKey = Object.keys(RESOURCE_ENTITIES).find((k) => RESOURCE_ENTITIES[k] === repo.target);
    const auditType = resourceKey ? AUDIT_TYPE_BY_RESOURCE[resourceKey] : undefined;

    let created = 0, updated = 0, skipped = 0;
    const errors: string[] = [];
    for (const { row: i, data: raw } of parsed) {
      const obj: Record<string, unknown> = {};
      for (const k of Object.keys(raw)) if (cols.has(k)) obj[k] = raw[k];
      for (const k of Object.keys(obj)) if (defaultedCols.has(k) && isEmpty(obj[k])) delete obj[k];
      try {
        let existing: ObjectLiteral | null = null;
        // a UUID is never reused: if the row's importUid belongs to a DELETED record, the id is
        // retired — we don't revive it; the row becomes a brand-new record with a fresh UUID.
        let retiredUid = false;
        if (hasUid && obj.importUid) {
          const m = await repo.findOne({ where: { importUid: obj.importUid }, withDeleted: true });
          if (m) { if ((m as { deletedAt?: unknown }).deletedAt) retiredUid = true; else existing = m; }
        }
        // natural unique keys (e.g. serverName) still match+restore — but not when the uid was retired
        if (!existing && !retiredUid) for (const mc of matchCols) { if (obj[mc]) { existing = await repo.findOne({ where: { [mc]: obj[mc] }, withDeleted: true }); if (existing) break; } }
        const missing = requiredCols.filter((rc) => existing ? rc in obj && isEmpty(obj[rc]) : !(rc in obj) || isEmpty(obj[rc]));
        if (missing.length) { skipped++; if (errors.length < 15) errors.push(`${label}${i}: missing required field(s): ${missing.join(', ')}`); continue; }
        if (existing) {
          if ((existing as { deletedAt?: unknown }).deletedAt) await repo.restore(existing.id);
          await repo.update(existing.id, obj);
          if (auditType) await recordUpdate(repo, auditType, existing.id, existing as Record<string, unknown>, obj);
          updated++;
        } else {
          // never reuse an id that belongs to a record (incl. soft-deleted): retired or blank → fresh UUID
          if (hasUid && (retiredUid || !obj.importUid)) obj.importUid = randomUUID();
          const saved = await repo.save(repo.create(obj)); created++;
          if (auditType) await recordLifecycle(repo, auditType, saved as Record<string, unknown>, 'created');
        }
      } catch (e) { skipped++; if (errors.length < 15) errors.push(`${label}${i}: ${(e as { message?: string }).message ?? String(e)}`); }
    }
    // tell the user when the error list was capped, so truncation isn't mistaken for success
    if (skipped > errors.length) errors.push(`…and ${skipped - errors.length} more row error(s) not shown.`);
    return { created, updated, skipped, errors };
  }

  // ---- Combined Projects + Environments bundle (one file; references by name/email) ----

  @Get('bundle/projects/export')
  async exportProjectsBundle(@CurrentUser() user: AuthUser, @Res() res: Response) {
    if (!buildAbility(user.permissions).can('read', 'infra.projects')) throw new ForbiddenException();
    const projRepo = this.repoFor('infra.projects');
    const envRepo = this.repoFor('infra.environments');
    const users = await this.lookupMap(this.dataSource.getRepository(User), 'email');
    const projects = await this.lookupMap(projRepo, 'name');
    const servers = await this.lookupMap(this.repoFor('infra.servers'), 'serverName');
    const gits = await this.lookupMap(this.repoFor('infra.git-providers'), 'name');

    const wb = new ExcelJS.Workbook();
    // `projectId` is the stable unique number for each project, shown in BOTH tabs: in Projects it
    // identifies the row; in Environments it links a row to its project (robust even if two projects
    // share a name). importUid stays hidden — it's what re-import matches on, so re-importing the same
    // file UPDATES rows (never duplicates).
    const allProjects = await projRepo.find();
    this.addDataSheet(wb, 'Projects', projRepo, allProjects, {
      prepend: [
        { header: 'projectId', value: (p) => p.id },
        { header: 'pocEmail', value: (p) => users.toLabel.get(p.pocUserId as number) ?? '' },
      ],
      exclude: ['id', 'pocUserId'],   // id shown as projectId; pocUserId covered by pocEmail
      hidden: ['importUid'],          // kept for round-trip matching, hidden in Excel
    });
    // Environments = the existing ones, PLUS a pre-filled template row (projectId + projectName, rest
    // blank) for every project that has no environment yet — so each project is listed in this tab and
    // you can just type the env details and re-import (no copy-paste from tab 1, no missing projects).
    const envRows = await envRepo.find();
    const haveEnv = new Set(envRows.map((e) => e.projectId));
    const envSeed = allProjects.filter((p) => !haveEnv.has(p.id)).map((p) => ({ projectId: p.id }));
    this.addDataSheet(wb, 'Environments', envRepo, [...envRows, ...envSeed], {
      prepend: [
        { header: 'projectId', value: (e) => e.projectId ?? '' },
        { header: 'projectName', value: (e) => projects.toLabel.get(e.projectId as number) ?? '' },
        { header: 'serverName', value: (e) => servers.toLabel.get(e.serverId as number) ?? '' },
        { header: 'gitProviderName', value: (e) => gits.toLabel.get(e.gitProviderId as number) ?? '' },
        { header: 'checklistSubmittedByEmail', value: (e) => users.toLabel.get(e.checklistSubmittedById as number) ?? '' },
      ],
      exclude: ['id', 'projectId', 'serverId', 'gitProviderId', 'checklistSubmittedById'],
      hidden: ['importUid'],
    });
    await this.addReferenceSheet(wb, [{ resource: 'infra.projects', repo: projRepo }, { resource: 'infra.environments', repo: envRepo }]);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="inframatrix-projects.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  }

  @Post('bundle/projects/import')
  @UseInterceptors(FileInterceptor('file'))
  async importProjectsBundle(@CurrentUser() user: AuthUser, @UploadedFile() file: { buffer: Buffer } | undefined) {
    const ab = buildAbility(user.permissions);
    if (!ab.can('create', 'infra.projects')) throw new ForbiddenException();
    if (!file) throw new NotFoundException('No file uploaded');
    const wb = await this.loadWorkbook(file.buffer);
    const projRepo = this.repoFor('infra.projects');
    const envRepo = this.repoFor('infra.environments');
    const users = await this.lookupMap(this.dataSource.getRepository(User), 'email');

    const merge = (link: { errors: string[]; skipped: number }, res: ImportResult): ImportResult =>
      ({ ...res, errors: [...link.errors, ...res.errors], skipped: res.skipped + link.skipped });

    // 1) Projects (resolve pocEmail → pocUserId)
    let projRes: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
    const pWs = wb.getWorksheet('Projects') ?? wb.worksheets[0];
    if (pWs) {
      const link = this.resolveLinks(this.parseSheet(pWs, projRepo, ['pocEmail']), [{ col: 'pocEmail', fk: 'pocUserId', map: users.toId }], 'Projects');
      projRes = merge(link, await this.upsertRows(projRepo, link.rows, 'Projects row '));
    }

    // 2) Environments (resolve projectName/serverName/gitProviderName/checklistSubmittedByEmail)
    let envRes: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
    const eWs = wb.getWorksheet('Environments');
    if (eWs) {
      if (!ab.can('create', 'infra.environments')) throw new ForbiddenException('You cannot import environments.');
      const projects = await this.lookupMap(projRepo, 'name'); // built AFTER project upsert
      const servers = await this.lookupMap(this.repoFor('infra.servers'), 'serverName');
      const gits = await this.lookupMap(this.repoFor('infra.git-providers'), 'name');
      // Link each environment to its project by the numeric projectId first (robust even when two
      // projects share a name); fall back to projectName. Neither set → skip with a clear message.
      const parsed = this.parseSheet(eWs, envRepo, ['projectName', 'serverName', 'gitProviderName', 'checklistSubmittedByEmail']);
      const projErrors: string[] = [];
      let projSkipped = 0;
      const withProject = parsed.filter((item) => {
        const rawId = Number(item.data.projectId);
        let pid: number | undefined = Number.isInteger(rawId) && rawId > 0 ? rawId : undefined;
        if (pid == null) pid = projects.toId.get(String(item.data.projectName ?? '').trim().toLowerCase());
        if (pid == null) {
          if (projErrors.length < 30) projErrors.push(`Environments row ${item.row}: project not found — set a valid projectId or projectName`);
          projSkipped++;
          return false;
        }
        item.data.projectId = pid;
        delete item.data.projectName;
        return true;
      });
      const link = this.resolveLinks(withProject, [
        { col: 'serverName', fk: 'serverId', map: servers.toId },
        { col: 'gitProviderName', fk: 'gitProviderId', map: gits.toId },
        { col: 'checklistSubmittedByEmail', fk: 'checklistSubmittedById', map: users.toId },
      ], 'Environments');
      // Dedupe: environments have no natural unique key, so without this a re-import (or a sheet that
      // lists the same env twice) keeps INSERTING — which is how the DB grew 1000+ duplicate rows.
      // Match an env by (projectId, type, url, serverId): point a matching row at the existing row's
      // importUid so upsertRows UPDATES it, and drop same-key repeats within the sheet. Type is
      // normalised to lower-case so "Live"/"live" collapse to one.
      const envKey = (r: Record<string, unknown>) =>
        `${r.projectId}|${String(r.type ?? '').trim().toLowerCase()}|${String(r.url ?? '').trim().toLowerCase()}|${r.serverId ?? ''}`;
      const existingByKey = new Map<string, string>();
      for (const e of await envRepo.find()) {
        const k = envKey(e);
        if (e.importUid && !existingByKey.has(k)) existingByKey.set(k, e.importUid as string);
      }
      const seenKey = new Set<string>();
      const deduped: ParsedRow[] = [];
      let mergedDups = 0;
      for (const item of link.rows) {
        item.data.type = String(item.data.type ?? '').trim().toLowerCase();
        const k = envKey(item.data);
        if (!item.data.importUid) { const uid = existingByKey.get(k); if (uid) item.data.importUid = uid; }
        if (seenKey.has(k)) { mergedDups++; continue; } // same env appears twice in the sheet → keep first
        seenKey.add(k);
        deduped.push(item);
      }
      const upserted = await this.upsertRows(envRepo, deduped, 'Environments row ');
      if (mergedDups) upserted.errors.push(`${mergedDups} duplicate environment row(s) in the sheet were merged (same project/type/url/server).`);
      envRes = merge({ errors: [...projErrors, ...link.errors], skipped: projSkipped + link.skipped }, upserted);
    }

    return {
      created: projRes.created + envRes.created,
      updated: projRes.updated + envRes.updated,
      skipped: projRes.skipped + envRes.skipped,
      errors: [...projRes.errors, ...envRes.errors],
      detail: { projects: projRes, environments: envRes },
    };
  }

  // ---- Generic single-resource export / import (servers, clients, vendors, ...) ----

  /** camelCase propertyName → "Camel Case" display label. */
  // Words shown in capitals / a fixed way in field labels ("Cicd status" → "CI/CD status", "Amc to" → "AMC to").
  private static readonly LABEL_WORDS: Record<string, string> = {
    url: 'URL', ip: 'IP', amc: 'AMC', cicd: 'CI/CD', os: 'OS', id: 'ID', poc: 'POC', api: 'API', uid: 'UID', ftp: 'FTP', ssl: 'SSL',
  };
  // Whole-name overrides where the plain conversion reads badly.
  private static readonly LABEL_NAMES: Record<string, string> = { isPublished: 'Published', poc: 'Point of contact', cicdStatus: 'CI/CD' };

  /** Readable, sentence-case label for a column/relation name — matches the style of the app's own forms. */
  private humanize(s: string): string {
    const fixed = DataController.LABEL_NAMES[s];
    if (fixed) return fixed;
    const words = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ').map((w) => DataController.LABEL_WORDS[w.toLowerCase()] ?? w.toLowerCase());
    const out = words.join(' ');
    return out.charAt(0).toUpperCase() + out.slice(1);
  }

  private static readonly UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  /** Cosmetic only — display the id column as an Odoo-style "module.identifier" external id instead of
   *  a bare UUID (e.g. "__export__.infra_servers_1_51c82bb6-..."), matching what Odoo's own
   *  import-compatible export looks like. The real identity is still the raw importUid embedded at the
   *  end; extractImportUid() below pulls it back out on import, so matching is exactly as before — this
   *  changes what the cell looks like, not what it means or how it's matched. */
  private formatImportUid(resource: string, id: number, uid: string): string {
    return `__export__.${resource.replace(/\./g, '_')}_${id}_${uid}`;
  }

  /** Inverse of formatImportUid: pulls the raw UUID back out of the wrapped display form. Also accepts
   *  a bare UUID unchanged, so files from the default export (or an older custom export) still match. */
  private extractImportUid(v: unknown): unknown {
    if (typeof v !== 'string') return v;
    const m = v.match(DataController.UUID_RE);
    return m ? m[0] : v;
  }

  /** Raw foreign-key columns (pocUserId, serverId…) — the picker offers the related record by NAME through
   *  its relation instead, so listing the bare id beside it is just noise. */
  private fkColumnsOf(repo: Repository<ObjectLiteral>): Set<string> {
    const out = new Set<string>();
    for (const rel of repo.metadata.relations) {
      const jc = rel.joinColumns?.[0];
      if (!jc) continue;
      const col = repo.metadata.columns.find((c) => c.databaseName === jc.databaseName && c.propertyName !== rel.propertyName);
      if (col) out.add(col.propertyName);
    }
    return out;
  }

  /**
   * The fields offered for export from this entity. `nested` = reached through a relation: a related
   * User exposes only id/name/email (never MFA state, status…). `includeFk` is for validating an
   * already-chosen path (an old saved template may still name a raw id) — the picker itself hides them.
   */
  private ownFieldsFor(repo: Repository<ObjectLiteral>, nested = false, includeFk = false): { name: string; label: string }[] {
    const skip = new Set(['createdAt', 'updatedAt', 'deletedAt', 'createdBy', 'updatedBy', 'importUid']);
    const secret = new Set(repo.metadata.columns.filter((c) => c.isSelect === false).map((c) => c.propertyName));
    const fks = includeFk ? new Set<string>() : this.fkColumnsOf(repo);
    const userOnly = nested && repo.metadata.target === User ? new Set(['id', 'name', 'email']) : null;
    return repo.metadata.columns
      .map((c) => c.propertyName)
      .filter((p) => !skip.has(p) && !secret.has(p) && !fks.has(p) && (!userOnly || userOnly.has(p)))
      .map((n) => ({ name: n, label: this.humanize(n) }));
  }

  /** Every relation off this repo, one step — to-one (many-to-one/one-to-one) AND to-many
   *  (one-to-many/many-to-many, e.g. a Server's reverse `environments`) — for the field picker's lazy
   *  tree; a node's own children are fetched only once the caller expands it (see GET .../fields).
   *  `labelField` (to-one only) names which of the target's own fields is the one the *existing*
   *  name-based link import (relationLinksFor/buildLinks, used by the default export/import) already
   *  matches by — the field picker marks exactly that one field writable, reusing that exact mechanism
   *  rather than inventing a second one. */
  private relationsFor(repo: Repository<ObjectLiteral>, chain: unknown[] = [], nested = false): { key: string; label: string; cardinality: 'one' | 'many'; labelField: string | null }[] {
    // a related User is a leaf (name/email only); and never offer a relation back to an entity already on
    // the path (Project → Environments → Project…): it only produces circular, confusing trees
    if (nested && repo.metadata.target === User) return [];
    return repo.metadata.relations.filter((r) => !chain.includes(r.inverseEntityMetadata.target)).map((r) => {
      const cardinality: 'one' | 'many' = r.relationType === 'many-to-one' || r.relationType === 'one-to-one' ? 'one' : 'many';
      const targetRepo = this.dataSource.getRepository(r.inverseEntityMetadata.target);
      return {
        key: r.propertyName,
        label: this.humanize(r.propertyName),
        cardinality,
        labelField: cardinality === 'one' ? this.pickLabelCol(targetRepo.metadata) : null,
      };
    });
  }

  /** Resolves one named relation off this repo, either cardinality — the single step the field tree
   *  and the export whitelist both walk, one segment of a dot-path at a time. */
  private relationStep(repo: Repository<ObjectLiteral>, key: string): { targetRepo: Repository<ObjectLiteral>; cardinality: 'one' | 'many'; labelField: string | null } | undefined {
    const r = repo.metadata.relations.find((x) => x.propertyName === key);
    if (!r) return undefined;
    const targetRepo = this.dataSource.getRepository(r.inverseEntityMetadata.target);
    const cardinality: 'one' | 'many' = r.relationType === 'many-to-one' || r.relationType === 'one-to-one' ? 'one' : 'many';
    return { targetRepo, cardinality, labelField: cardinality === 'one' ? this.pickLabelCol(targetRepo.metadata) : null };
  }

  // relation hops + the final own field — generous for this app's real schema, a hard stop against an
  // abusive query string rather than a meaningful UI limit (nothing here is naturally deeper than ~3).
  private static readonly MAX_FIELD_DEPTH = 4;

  @Get(':resource/fields')
  fields(@Param('resource') resource: string, @Query('path') path: string | undefined, @CurrentUser() user: AuthUser) {
    if (!buildAbility(user.permissions).can('read', resource)) throw new ForbiddenException();
    let repo = this.repoFor(resource);
    const chain: unknown[] = [repo.metadata.target];
    let nested = false;
    if (path) {
      const segments = path.split('.').filter(Boolean);
      if (segments.length > DataController.MAX_FIELD_DEPTH) throw new BadRequestException('Path too deep.');
      for (const seg of segments) {
        const step = this.relationStep(repo, seg);
        if (!step) throw new BadRequestException(`Unknown relation: ${seg}`);
        repo = step.targetRepo;
        chain.push(repo.metadata.target);
        nested = true;
      }
    }
    return {
      own: this.ownFieldsFor(repo, nested),
      relations: this.relationsFor(repo, chain, nested),
      // whether THIS node's entity has a stable re-import identity — only meaningful at the root
      // (path=''), where the picker uses it to decide whether "Import-compatible export" can be offered.
      hasImportUid: repo.metadata.columns.some((c) => c.propertyName === 'importUid'),
    };
  }

  /**
   * Validates + resolves one requested export field path end to end (e.g. "environments.project.name"):
   * every segment but the last must be a real relation off the previous entity, the last must be a real
   * own field of the entity reached — walked fresh against the live metadata graph, so the query string
   * can never reach a property this doesn't confirm exists. Returns null for anything that doesn't check out.
   */
  private walkFieldPath(rootRepo: Repository<ObjectLiteral>, fullPath: string): FieldPathWalk | null {
    const segments = fullPath.split('.').filter(Boolean);
    if (!segments.length || segments.length > DataController.MAX_FIELD_DEPTH) return null;
    const ownField = segments[segments.length - 1];
    let repo = rootRepo;
    const hops: FieldPathWalk['hops'] = [];
    for (const seg of segments.slice(0, -1)) {
      const step = this.relationStep(repo, seg);
      if (!step) return null;
      hops.push({ key: seg, cardinality: step.cardinality, label: this.humanize(seg), labelField: step.labelField });
      repo = step.targetRepo;
    }
    if (!this.ownFieldsFor(repo, hops.length > 0, true).some((f) => f.name === ownField)) return null;
    return { hops, ownField, label: [...hops.map((h) => h.label), this.humanize(ownField)].join(': ') };
  }

  /** Merges every requested path's relation hops into one nested TypeORM `relations` tree, so a single
   *  `repo.find()` eager-loads exactly what's needed regardless of how many fields (or how deep) were picked. */
  private mergeRelationsTree(walks: FieldPathWalk[]): FindOptionsRelations<ObjectLiteral> {
    const tree: Record<string, unknown> = {};
    for (const w of walks) {
      let node = tree;
      for (const hop of w.hops) {
        node[hop.key] = (node[hop.key] as Record<string, unknown>) ?? {};
        node = node[hop.key] as Record<string, unknown>;
      }
    }
    return tree as FindOptionsRelations<ObjectLiteral>;
  }

  /** Resolves one field path's value off a loaded row. The moment the path crosses a to-many hop (e.g.
   *  a server's `environments`), it fans out and joins the remaining sub-path's values with "; " — one
   *  parent row can't hold many child rows in a single flat cell any other way without multiplying the
   *  whole export's row count, which would silently change what "one row" means for every other column. */
  private resolvePathValue(row: unknown, hops: FieldPathWalk['hops'], ownField: string): unknown {
    if (!hops.length) return (row as Record<string, unknown> | null)?.[ownField] ?? null;
    const [hop, ...rest] = hops;
    const next = (row as Record<string, unknown> | null)?.[hop.key];
    if (next == null) return hop.cardinality === 'many' ? '' : null;
    if (hop.cardinality === 'many') {
      const arr = Array.isArray(next) ? next : [next];
      return arr
        .map((item) => this.resolvePathValue(item, rest, ownField))
        .filter((v) => v !== null && v !== undefined && v !== '')
        .join('; ');
    }
    return this.resolvePathValue(next, rest, ownField);
  }

  @Get(':resource/export')
  async export(
    @Param('resource') resource: string,
    @Query() query: Record<string, string>,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    if (!buildAbility(user.permissions).can('read', resource)) throw new ForbiddenException();
    const repo = this.repoFor(resource);
    // Optional equality filter from the query string (e.g. ?serverId=5) — only real columns on this
    // resource are honoured, so a related panel (e.g. "Hosting on this server") can export exactly the
    // filtered rows it's already showing, instead of the whole resource every time. `ids` is a special
    // case: an explicit id list (e.g. from a list view's row-selection checkboxes → "Export selected").
    const { fields: fieldsParam, format, ids: idsParam, importCompatible, ...filterQuery } = query;
    const columnNames = new Set(repo.metadata.columns.map((c) => c.propertyName));
    const where: Record<string, unknown> = {};
    if (idsParam) {
      const ids = idsParam.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n));
      if (ids.length) where.id = In(ids);
    }
    for (const [k, v] of Object.entries(filterQuery)) {
      if (!columnNames.has(k) || v === undefined || v === '') continue;
      where[k] = /^-?\d+$/.test(v) ? Number(v) : v;
    }
    const filtered = Object.keys(where).length > 0;

    // ---- Odoo-style custom export: caller picked exactly which fields (own, or an arbitrary-depth
    // "relation.relation.field" chain including one-to-many/many-to-many drill-in), in what order, XLSX
    // or CSV, and optionally "import-compatible" — used by the export field-picker on every list view. ----
    if (fieldsParam) {
      const requested = fieldsParam.split(',').map((s) => s.trim()).filter(Boolean);
      const resolved: { path: string; walked: FieldPathWalk }[] = [];
      for (const p of requested) {
        const walked = this.walkFieldPath(repo, p);
        if (walked) resolved.push({ path: p, walked });
      }
      if (!resolved.length) throw new BadRequestException('No valid fields selected.');

      // "Import-compatible": prepend the stable per-record identity column (importUid) so re-importing
      // this sheet updates the same records instead of creating duplicates — Odoo's "I want to update
      // data (import-compatible export)". Only offered when this resource actually has importUid: the
      // shared import parser deliberately never matches on the raw database `id` (reusing/copy-pasting
      // a literal id is exactly the kind of accidental-overwrite risk that column exists to avoid), so
      // a resource without importUid (e.g. core.users, matched by email instead) has no safe re-import
      // identity to offer here.
      const hasImportUid = columnNames.has('importUid');
      const wantsId = hasImportUid && (importCompatible === '1' || importCompatible === 'true');

      const rows = await repo.find({
        where: filtered ? where : undefined,
        relations: this.mergeRelationsTree(resolved.map((r) => r.walked)),
      });

      // Header text is what the shared import endpoint actually matches on. Three cases: the id column
      // gets the literal 'importUid'; an OWN field's header is its real propertyName; a single to-one
      // hop landing on exactly that relation's *label* column (e.g. "poc" -> its .name) gets the raw
      // relation propertyName ('poc') -- the exact header shape relationLinksFor/buildLinks already
      // produces for the default export, so the existing, already-tested name-based link resolution
      // (case/space-insensitive match against existing records, clear per-row "not found" errors) picks
      // it up on import with no new logic, and it's genuinely safe to write back: picking a different
      // name really does mean "point this record at that other one". Every other relation-drilled
      // column (a non-label sub-field, or anything reached through a to-many hop) keeps the pretty
      // "Relation: Field" label, which deliberately matches nothing — reference-only, never written back
      // (there's no sane target for e.g. writing a server's IP back through an environment row, and no
      // per-item identity survives a flattened to-many list).
      const isLinkedField = (w: FieldPathWalk) =>
        w.hops.length === 1 && w.hops[0].cardinality === 'one' && w.hops[0].labelField === w.ownField;
      const wsName = 'data';
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(wsName);
      // Like Odoo: a plain export gets readable headings ("AMC status", "Point of contact: Name"); only an
      // import-compatible one needs the technical headings above, because those are what the import matches.
      const technical = importCompatible === '1' || importCompatible === 'true';
      const seenHeaders = new Map<string, number>();
      const headerFor = (w: FieldPathWalk) => {
        const h = !technical ? w.label : w.hops.length === 0 ? w.ownField : isLinkedField(w) ? w.hops[0].key : w.label;
        const n = (seenHeaders.get(h) ?? 0) + 1; // two picks can share a label — keep the columns distinguishable
        seenHeaders.set(h, n);
        return n === 1 ? h : `${h} (${n})`;
      };
      ws.columns = [
        ...(wantsId ? [{ header: 'importUid', key: '__id', width: 26 }] : []),
        ...resolved.map((r) => ({ header: headerFor(r.walked), key: r.path, width: 22 })),
      ];
      for (const r of rows as Record<string, unknown>[]) {
        const out: Record<string, unknown> = {};
        if (wantsId) out.__id = r.importUid ? this.formatImportUid(resource, r.id as number, r.importUid as string) : '';
        for (const { path, walked } of resolved) {
          const v = this.resolvePathValue(r, walked.hops, walked.ownField);
          out[path] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
        }
        ws.addRow(out);
      }
      ws.getRow(1).font = { bold: true };

      const base = resource.replace(/\./g, '-') + (filtered ? '-filtered' : '');
      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
        await wb.csv.write(res, { sheetName: wsName }); // pipes to res and ends it itself
      } else {
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${base}.xlsx"`);
        await wb.xlsx.write(res);
        res.end();
      }
      return;
    }

    // ---- Default: every column + relation-label columns, plus the reference/import-template sheet
    // (this shape is what re-import expects, so it stays the default when no field list is given). ----
    const links = await this.buildLinks(repo);
    const wb = new ExcelJS.Workbook();
    // each relation FK (vendorId, clientId, …) is shown as a readable name column and the raw id is hidden
    const rows = await (filtered ? repo.find({ where }) : repo.find());
    // template seeding: append one blank row per related record (e.g. every vendor) not already
    // present, so you can fill the remaining columns and re-import in bulk. Skipped on a filtered
    // export — seeding every related record wouldn't make sense once we're scoped to a subset.
    const seedRel = filtered ? undefined : EXPORT_TEMPLATE_FROM[resource];
    const seedLink = seedRel ? links.find((l) => l.header === seedRel) : undefined;
    if (seedLink) {
      const present = new Set(rows.map((r) => r[seedLink.fkProp]));
      const seeded = [...seedLink.toLabel.entries()]
        .filter(([id]) => !present.has(id))
        .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
        .map(([id]) => ({ [seedLink.fkProp]: id }) as ObjectLiteral);
      rows.push(...seeded);
    }
    const hasUid = this.columns(repo).includes('importUid');
    this.addDataSheet(wb, 'data', repo, rows, {
      // importUid is the stable per-record id (first column): keep it on a row to UPDATE that record,
      // leave it BLANK on a new row to CREATE a new record (e.g. another service for the same vendor).
      prepend: [
        ...(hasUid ? [{ header: 'importUid', value: (r: ObjectLiteral) => r.importUid ?? '' }] : []),
        ...links.map((l) => ({ header: l.header, value: (r: ObjectLiteral) => l.toLabel.get(r[l.fkProp] as number) ?? '' })),
      ],
      exclude: ['id', 'importUid', ...links.map((l) => l.fkProp)],
    });
    await this.addReferenceSheet(wb, [{ resource, repo }]);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${resource.replace(/\./g, '-')}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  }

  @Post(':resource/import')
  @UseInterceptors(FileInterceptor('file'))
  async import(@Param('resource') resource: string, @CurrentUser() user: AuthUser, @UploadedFile() file: { buffer: Buffer } | undefined) {
    if (!buildAbility(user.permissions).can('create', resource)) throw new ForbiddenException();
    if (!file) throw new NotFoundException('No file uploaded');
    const repo = this.repoFor(resource);
    const wb = await this.loadWorkbook(file.buffer);
    const ws = wb.worksheets[0];
    if (!ws) return { created: 0, updated: 0, skipped: 0, errors: [] };
    // resolve the readable name columns (vendor, client, …) back to FK ids, then upsert
    const links = await this.buildLinks(repo);
    const parsed = this.parseSheet(ws, repo, links.map((l) => l.header));
    // drop unfilled template rows: a row that only names a relation (e.g. vendor) with no other
    // data is a blank template row — skip it silently so the seeded export doesn't create empties.
    const linkHeaders = new Set(links.map((l) => l.header));
    const hasData = (d: Record<string, unknown>) =>
      Object.keys(d).some((k) => !linkHeaders.has(k) && k !== 'importUid' && d[k] !== null && d[k] !== '' && d[k] !== undefined);
    const rows = parsed.filter((p) => hasData(p.data));
    // Users are special: they CREATE (not skip) on import — a new user is made with an auto-generated
    // password (hashed) so it can be onboarded with a "set your password" link, and existing users are
    // updated by email (password untouched). The generic upsert can't do this (password is required +
    // never in the sheet, and must be hashed), so route core.users through a dedicated importer.
    if (resource === 'core.users') return this.importUsers(rows);
    // copy-safe: if the same importUid appears on more than one row (e.g. a row was copied to add a
    // second service for the same vendor), keep it on the first and blank the rest so they create
    // new records instead of all overwriting the same one.
    const seenUid = new Set<string>();
    for (const p of rows) {
      const uid = p.data.importUid;
      if (uid == null || uid === '') continue;
      const key = String(uid).trim();
      if (seenUid.has(key)) p.data.importUid = null;
      else seenUid.add(key);
    }
    const linked = this.resolveLinks(rows, links.map((l) => ({ col: l.header, fk: l.fkProp, map: l.toId })), resource);
    const res = await this.upsertRows(repo, linked.rows, `${resource} row `);
    return { ...res, errors: [...linked.errors, ...res.errors], skipped: res.skipped + linked.skipped };
  }

  /**
   * Import users: update existing (matched by email; password left as-is) and CREATE new ones with an
   * auto-generated hashed password, so imported users exist immediately and can be onboarded via a
   * "set your password" link (Users screen → Send password setup). Never writes plaintext passwords.
   */
  private async importUsers(rows: ParsedRow[]): Promise<ImportResult> {
    const repo = this.repoFor('core.users');
    let created = 0, updated = 0, skipped = 0;
    const errors: string[] = [];
    for (const { row: i, data } of rows) {
      const email = String(data.email ?? '').trim();
      if (!email) { skipped++; if (errors.length < 15) errors.push(`core.users row ${i}: email is required`); continue; }
      const name = String(data.name ?? '').trim() || email;
      try {
        const existing = await repo.findOne({ where: { email }, withDeleted: true });
        if (existing && !(existing as { deletedAt?: unknown }).deletedAt) {
          const patch: Record<string, unknown> = { name };
          if (data.status != null && data.status !== '') patch.status = data.status;
          await repo.update(existing.id, patch);
          await recordUpdate(repo, 'user', existing.id, existing as Record<string, unknown>, patch);
          updated++;
        } else {
          // new (or soft-deleted) email → UsersService.create restores + auto-generates a hashed password
          await this.usersService.create({ name, email });
          created++;
        }
      } catch (e) {
        skipped++;
        if (errors.length < 15) errors.push(`core.users row ${i}: ${(e as { message?: string }).message ?? String(e)}`);
      }
    }
    if (skipped > errors.length) errors.push(`…and ${skipped - errors.length} more row error(s) not shown.`);
    return { created, updated, skipped, errors };
  }
}
