import {
  BadRequestException, Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Patch, Post, UseGuards,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { DeepPartial } from 'typeorm';
import { Project } from './entities/project.entity';
import { Environment } from './entities/environment.entity';
import { Integration } from './entities/integration.entity';
import { Server } from './entities/server.entity';
import { CrudService } from '../common/crud.service';
import { User } from '../users/entities/user.entity';
import { auditRow, insertAudit } from '../audit/audit.util';
import { computeProjectReasons, groupIntegrations } from './readiness.util';
import { computeIntegrationFlags } from './integration-fields.util';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

const RES = 'infra.projects';

@Injectable()
class ProjectsService extends CrudService<Project> {
  constructor(
    @InjectRepository(Project) repo: Repository<Project>,
    @InjectRepository(Environment) private readonly envRepo: Repository<Environment>,
    @InjectRepository(Integration) private readonly intRepo: Repository<Integration>,
    @InjectRepository(Server) private readonly serverRepo: Repository<Server>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {
    super(repo, ['poc', 'developers'], [{ from: 'amcFrom', to: 'amcTo', label: 'AMC to date' }], 'project');
  }

  /** Expose a project's developers as just id/name/email (never the full user row — it carries MFA
   *  state etc.), plus `developerIds` for the edit form and `developerNames` for list search/filter. */
  private slim(p: Project): Project {
    const devs = (p.developers ?? []).map((u) => ({ id: u.id, name: u.name, email: u.email }));
    return { ...p, developers: devs, developerIds: devs.map((d) => d.id), developerNames: devs.map((d) => d.name) } as unknown as Project;
  }

  async list(): Promise<Project[]> {
    return (await super.list()).map((p) => this.slim(p));
  }

  async findOne(id: number): Promise<Project | null> {
    const p = await super.findOne(id);
    return p ? this.slim(p) : null;
  }

  /** Pull `developerIds` off the payload (the base update can't write a many-to-many) and validate it. */
  private async takeDeveloperIds(d: Record<string, unknown>): Promise<number[] | null> {
    const raw = d.developerIds;
    delete d.developerIds;
    delete d.developers;
    if (!Array.isArray(raw)) return null;
    const ids = [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (ids.length) {
      const found = await this.userRepo.find({ where: { id: In(ids) }, select: { id: true } });
      if (found.length !== ids.length) throw new BadRequestException('One or more selected developers no longer exist.');
    }
    return ids;
  }

  /** Make the project's developer set exactly `ids`, and log the change by NAME ("Asha, Ravi → Asha"). */
  private async syncDevelopers(id: number, ids: number[], projectName: string): Promise<void> {
    const current = await this.repo.createQueryBuilder('p').relation(Project, 'developers').of(id).loadMany<User>();
    const have = new Set(current.map((u) => u.id));
    const want = new Set(ids);
    const add = ids.filter((x) => !have.has(x));
    const remove = current.filter((u) => !want.has(u.id)).map((u) => u.id);
    if (!add.length && !remove.length) return;
    await this.repo.createQueryBuilder('p').relation(Project, 'developers').of(id).addAndRemove(add, remove);
    const added = add.length ? await this.userRepo.find({ where: { id: In(add) } }) : [];
    const names = (us: { name: string }[]) => us.map((u) => u.name).sort().join(', ');
    const kept = current.filter((u) => want.has(u.id));
    await insertAudit(this.repo.manager, [auditRow('project', id, {
      action: 'updated', entityLabel: projectName.slice(0, 255), field: 'developers', fieldLabel: 'Developers',
      oldValue: names(current), newValue: names([...kept, ...added]),
    })]);
  }

  async create(dto: DeepPartial<Project>): Promise<Project> {
    const ids = await this.takeDeveloperIds(dto as Record<string, unknown>);
    const saved = await super.create(dto);
    if (ids?.length) await this.syncDevelopers(saved.id, ids, saved.name);
    return (await this.findOne(saved.id)) as Project;
  }

  async update(id: number, dto: DeepPartial<Project>): Promise<Project | null> {
    const d = dto as Record<string, unknown>;
    const ids = await this.takeDeveloperIds(d);
    // a developers-only change leaves nothing for the base column update to write
    if (Object.keys(d).length) await super.update(id, dto);
    if (ids) {
      const p = await this.repo.findOne({ where: { id }, select: { id: true, name: true } });
      if (p) await this.syncDevelopers(id, ids, p.name);
    }
    return this.findOne(id);
  }

  /** Old-InfraMatrix publish-readiness checks for one project — list of blocking reasons (empty = ready). */
  async readiness(id: number): Promise<string[]> {
    const p = await this.repo.findOne({ where: { id } });
    if (!p) return ['Project not found'];
    const envs = await this.envRepo.find({ where: { projectId: id } });
    const ints = envs.length
      ? await this.intRepo.find({ where: { environmentId: In(envs.map((e) => e.id)) }, relations: { integrationType: true } })
      : [];
    return computeProjectReasons(p, envs, groupIntegrations(ints));
  }

  /**
   * List every project with its publish state. Batch-loads all environments and integrations in
   * a constant number of queries (no per-project N+1) so it scales to thousands of projects.
   */
  async listWithState() {
    const projects = await this.list();
    if (!projects.length) return [];
    const envs = await this.envRepo.find({ where: { projectId: In(projects.map((p) => p.id)) } });
    const ints = envs.length
      ? await this.intRepo.find({ where: { environmentId: In(envs.map((e) => e.id)) }, relations: { integrationType: true, account: true } })
      : [];
    const intsByEnvId = groupIntegrations(ints);
    // Resolve each environment's server once (name + IP) so the list can show "where is this hosted"
    // inline — no more drilling project → environment → server module to find a server's IP.
    const serverIds = [...new Set(envs.map((e) => e.serverId).filter((x): x is number => x != null))];
    const servers = serverIds.length ? await this.serverRepo.find({ where: { id: In(serverIds) } }) : [];
    const serverById = new Map(servers.map((s) => [s.id, s]));
    const envsByProject = new Map<number, Environment[]>();
    for (const e of envs) {
      const k = e.projectId as number;
      const arr = envsByProject.get(k);
      if (arr) arr.push(e); else envsByProject.set(k, [e]);
    }
    return projects.map((p) => {
      const pEnvs = envsByProject.get(p.id) ?? [];
      // Compact hosting summary per environment: type, URL, server name + IP + provider.
      const hosting = pEnvs.map((e) => {
        const s = e.serverId != null ? serverById.get(e.serverId) : null;
        return {
          envId: e.id,
          type: e.type,
          url: e.url ?? null,
          server: s?.serverName ?? null,
          serverIp: s?.publicIp ?? s?.privateIp ?? null,
          provider: s?.provider ?? null,
        };
      });
      // Environments + integrations live in their OWN tables — these aggregates let the Projects list
      // filter/search reach into them ("projects whose env URL contains X", "projects having SendGrid",
      // "projects with Technology = php 8.3"). Each is an array → the filter matches if ANY child matches.
      const pInts = pEnvs.flatMap((e) => intsByEnvId.get(e.id) ?? []);
      const envUrls = [...new Set(pEnvs.map((e) => e.url).filter((x): x is string => !!x))];
      const envTypes = [...new Set(pEnvs.map((e) => e.type).filter((x): x is string => !!x))];
      const envServers = [...new Set(hosting.map((h) => h.server).filter((x): x is string => !!x))];
      const integrationTypes = [...new Set(pInts.map((i) => i.integrationType?.name).filter((x): x is string => !!x))];
      // Key (for key_value types like "Technology" → "PHP") and value ("8.3") on their OWN — so you can
      // target them separately ("Integration key contains php", "Integration value contains 8").
      const integrationKeys = [...new Set(pInts.map((i) => i.keyName).filter((x): x is string => !!x))];
      const integrationValues = [...new Set(pInts.map((i) => i.value).filter((x): x is string => !!x))];
      // One combined "<type> <key> <value> <account>" string PER integration → a single rule
      // "Integration (type·key·value) contains php 8" matches the SAME integration (no cross-matching
      // a different integration on the same project).
      const integrationDetails = pInts
        .map((i) => [i.integrationType?.name, i.keyName, i.value, i.account?.accountName].filter(Boolean).join(' '))
        .filter(Boolean);
      // Flat string so free-text search finds a project by its env (url/server/ip) or any integration.
      const hostingText = [
        hosting.map((h) => [h.type, h.url, h.server, h.serverIp, h.provider].filter(Boolean).join(' ')).join(' | '),
        integrationDetails.join(' | '),
      ].filter(Boolean).join(' | ');
      // Dashboard drill-down filters (?envLiveMissingChecklist=true / ?hasIntegrationFlags=true).
      const envLiveMissingChecklist = pEnvs.some((e) => e.type === 'live' && !e.checklistCompleted);
      const hasIntegrationFlags = pInts.some((i) => computeIntegrationFlags(i).length > 0);
      return {
        ...p,
        publishState: p.isPublished ? 'published'
          : computeProjectReasons(p, pEnvs, intsByEnvId).length === 0 ? 'ready' : 'draft',
        hosting,
        hostingText,
        envUrls,
        envTypes,
        envServers,
        integrationTypes,
        integrationKeys,
        integrationValues,
        integrationDetails,
        envLiveMissingChecklist,
        hasIntegrationFlags,
      };
    });
  }

  async publish(id: number) {
    const reasons = await this.readiness(id);
    if (reasons.length) throw new BadRequestException({ message: 'Project is not ready to publish.', reasons });
    return this.update(id, { isPublished: true } as never); // via update() so the change-log records it
  }

  async revert(id: number) {
    return this.update(id, { isPublished: false } as never);
  }
  // Deleting a project removes its environments + integrations automatically via DB onDelete:CASCADE
  // (hard delete). No app-level cascade needed.
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('infra/projects')
class ProjectsController {
  constructor(private readonly service: ProjectsService) {}
  @Get() @RequirePermission('read', RES) list() { return this.service.listWithState(); }
  @Get(':id/readiness') @RequirePermission('read', RES) readiness(@Param('id', ParseIntPipe) id: number) { return this.service.readiness(id); }
  @Get(':id') @RequirePermission('read', RES) get(@Param('id', ParseIntPipe) id: number) { return this.service.findOne(id); }
  @Post() @RequirePermission('create', RES) create(@Body() dto: DeepPartial<Project>) { return this.service.create(dto); }
  @Post(':id/publish') @RequirePermission('update', RES) publish(@Param('id', ParseIntPipe) id: number) { return this.service.publish(id); }
  @Post(':id/revert') @RequirePermission('update', RES) revert(@Param('id', ParseIntPipe) id: number) { return this.service.revert(id); }
  @Patch(':id') @RequirePermission('update', RES) update(@Param('id', ParseIntPipe) id: number, @Body() dto: DeepPartial<Project>) { return this.service.update(id, dto); }
  @Delete(':id') @RequirePermission('delete', RES) remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}

@Module({
  imports: [TypeOrmModule.forFeature([Project, Environment, Integration, Server, User])],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
