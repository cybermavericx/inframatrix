import { Controller, Get, Injectable, Module, UseGuards } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Server } from '../infra/entities/server.entity';
import { Project } from '../infra/entities/project.entity';
import { Environment } from '../infra/entities/environment.entity';
import { Integration } from '../infra/entities/integration.entity';
import { User } from '../users/entities/user.entity';
import { Client } from '../jobbag/entities/client.entity';
import { Vendor } from '../jobbag/entities/vendor.entity';
import { VendorService as VendorSvc } from '../jobbag/entities/vendor-service.entity';
import { Job } from '../jobbag/entities/job.entity';
import { Reminder } from '../jobbag/entities/reminder.entity';
import { computeProjectReasons, groupIntegrations } from '../infra/readiness.util';
import { computeIntegrationFlags } from '../infra/integration-fields.util';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { buildAbility } from '../common/casl/ability.factory';
import type { AuthUser } from '../auth/auth.types';

const inc = (m: Record<string, number>, k: string | null | undefined) => { const key = k ?? '(none)'; m[key] = (m[key] ?? 0) + 1; };

@Injectable()
class DashboardService {
  constructor(
    @InjectRepository(Server) private readonly servers: Repository<Server>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(Environment) private readonly envs: Repository<Environment>,
    @InjectRepository(Integration) private readonly ints: Repository<Integration>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Client) private readonly clients: Repository<Client>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(VendorSvc) private readonly vendorServices: Repository<VendorSvc>,
    @InjectRepository(Job) private readonly jobs: Repository<Job>,
    @InjectRepository(Reminder) private readonly reminders: Repository<Reminder>,
  ) {}

  /** Everything the dashboard needs, computed in a constant number of queries (scales to thousands of rows). */
  async stats(ability: ReturnType<typeof buildAbility>) {
    // ---- Infra: batch-load everything once ----
    const [servers, projects, envs, allUsers] = await Promise.all([
      this.servers.find(),
      this.projects.find(),
      this.envs.find(),
      this.users.find(),
    ]);
    const ints = envs.length
      ? await this.ints.find({ where: { environmentId: In(envs.map((e) => e.id)) }, relations: { integrationType: true } })
      : [];
    const intsByEnvId = groupIntegrations(ints);
    const envsByProject = new Map<number, Environment[]>();
    for (const e of envs) { const k = e.projectId as number; const a = envsByProject.get(k); if (a) a.push(e); else envsByProject.set(k, [e]); }
    const userById = new Map<number, User>(allUsers.map((u) => [u.id, u]));
    const envById = new Map<number, Environment>(envs.map((e) => [e.id, e]));
    const projectById = new Map<number, Project>(projects.map((p) => [p.id, p]));

    // custom-fields integrations (e.g. CMS Access) flagged for a generic/avoided or non-suggested value
    const integrationFlagItems = ints
      .map((it) => {
        const flags = computeIntegrationFlags(it);
        if (!flags.length) return null;
        const env = it.environmentId != null ? envById.get(it.environmentId) : undefined;
        const project = env?.projectId != null ? projectById.get(env.projectId) : undefined;
        return {
          projectId: project?.id ?? null,
          projectName: project?.name ?? '(unknown project)',
          envId: env?.id ?? null,
          envType: env?.type ?? '(unknown environment)',
          integrationTypeName: it.integrationType?.name ?? '(unknown type)',
          flags,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
    const integrationFlags = { total: integrationFlagItems.length, items: integrationFlagItems.slice(0, 50) };

    // every attached integration (for the dashboard's "Integrations" drill-down — no dedicated list page exists)
    const integrationItems = ints.map((it) => {
      const env = it.environmentId != null ? envById.get(it.environmentId) : undefined;
      const project = env?.projectId != null ? projectById.get(env.projectId) : undefined;
      return {
        projectId: project?.id ?? null,
        projectName: project?.name ?? '(unknown project)',
        envId: env?.id ?? null,
        envType: env?.type ?? '(unknown environment)',
        integrationTypeName: it.integrationType?.name ?? '(unknown type)',
        detail: it.keyName ? `${it.keyName}: ${it.value ?? ''}` : (it.value ?? ''),
      };
    });

    // servers
    const serversByStatus: Record<string, number> = {};
    const serversByProvider: Record<string, number> = {};
    let serversAmc = 0;
    for (const s of servers) { inc(serversByStatus, s.status); inc(serversByProvider, s.provider); if (s.amc) serversAmc++; }

    // per-server hosting usage: how many environments (hostings) sit on each server vs its capacity
    const usedByServer = new Map<number, number>();
    for (const e of envs) if (e.serverId != null) usedByServer.set(e.serverId, (usedByServer.get(e.serverId) ?? 0) + 1);
    const serversUsage = servers.map((s) => {
      const used = usedByServer.get(s.id) ?? 0;
      const capacity = s.capacity ?? null;
      return { id: s.id, serverName: s.serverName, provider: s.provider, capacity, used, free: capacity != null ? capacity - used : null };
    }).sort((a, b) => {
      // servers nearest/over capacity first, then by most used
      const fa = a.free == null ? Infinity : a.free;
      const fb = b.free == null ? Infinity : b.free;
      return fa - fb || b.used - a.used;
    });

    // environments (normalise type case — imported data may use "Live"/"Staging")
    const envByType: Record<string, number> = { staging: 0, uat: 0, live: 0 };
    let liveMissingChecklist = 0;
    for (const e of envs) {
      const t = String(e.type ?? '').trim().toLowerCase();
      if (t === 'staging' || t === 'uat' || t === 'live') envByType[t]++; else inc(envByType, t || '(none)');
      if (t === 'live' && !e.checklistCompleted) liveMissingChecklist++;
    }
    // for the dashboard's "Environments" / "Live envs missing checklist" drill-downs (no dedicated list page)
    const environmentItems = envs.map((e) => {
      const project = e.projectId != null ? projectById.get(e.projectId) : undefined;
      return {
        projectId: project?.id ?? null,
        projectName: project?.name ?? '(unknown project)',
        envId: e.id,
        type: e.type ?? '(none)',
        url: e.url ?? null,
        checklistCompleted: !!e.checklistCompleted,
      };
    });

    // projects + per-POC breakdown
    let published = 0, ready = 0, draft = 0, withoutPoc = 0;
    const pocMap = new Map<number | 0, { pocUserId: number | null; name: string; email: string; total: number; published: number; unpublished: number; missingChecklist: number }>();
    const pocBucket = (p: Project) => {
      const id = (p.pocUserId ?? 0) as number | 0;
      let b = pocMap.get(id);
      if (!b) {
        const u = p.pocUserId ? userById.get(p.pocUserId) : undefined;
        b = { pocUserId: p.pocUserId ?? null, name: u?.name ?? 'Unassigned', email: u?.email ?? '', total: 0, published: 0, unpublished: 0, missingChecklist: 0 };
        pocMap.set(id, b);
      }
      return b;
    };

    for (const p of projects) {
      const pEnvs = envsByProject.get(p.id) ?? [];
      const isReady = !p.isPublished && computeProjectReasons(p, pEnvs, intsByEnvId).length === 0;
      const missingChecklist = pEnvs.some((e) => e.type === 'live' && !e.checklistCompleted);
      if (p.isPublished) published++; else if (isReady) ready++; else draft++;
      if (!p.pocUserId) withoutPoc++;
      const b = pocBucket(p);
      b.total++;
      if (p.isPublished) b.published++; else b.unpublished++;
      if (missingChecklist) b.missingChecklist++;
    }
    const byPoc = [...pocMap.values()].sort((a, b) => b.unpublished - a.unpublished || b.total - a.total);

    // ---- JobBag ----
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const today = now.toISOString().slice(0, 10);
    const vendorServicesAll = await this.vendorServices.find();
    const expiringSoon = vendorServicesAll.filter((v) => v.isRenewable === 'Y' && v.expiryDate && v.expiryDate >= today && v.expiryDate <= in30).length;
    const [clients, vendors, jobs, reminders] = await Promise.all([
      this.clients.count(), this.vendors.count(), this.jobs.count(), this.reminders.count(),
    ]);

    // Each section is only filled in for a user who may READ that resource — the dashboard is open to
    // every logged-in user, and it must not hand someone with (say) only JobBag access the server IPs,
    // environment URLs or POC emails of Infra, nor the reverse. Others get the same shape, zeroed.
    const can = (resource: string) => ability.can('read', resource);
    const zeroEnv: Record<string, number> = { staging: 0, uat: 0, live: 0 };
    return {
      servers: can('infra.servers') ? { total: servers.length, byStatus: serversByStatus, byProvider: serversByProvider, amc: serversAmc } : { total: 0, byStatus: {}, byProvider: {}, amc: 0 },
      serversUsage: can('infra.servers') ? serversUsage : [],
      projects: can('infra.projects') ? { total: projects.length, published, unpublished: projects.length - published, ready, draft, withoutPoc } : { total: 0, published: 0, unpublished: 0, ready: 0, draft: 0, withoutPoc: 0 },
      environments: can('infra.environments') ? { total: envs.length, ...envByType, liveMissingChecklist, items: environmentItems.slice(0, 200) } : { total: 0, ...zeroEnv, liveMissingChecklist: 0, items: [] },
      integrations: can('infra.integrations') ? { total: ints.length, items: integrationItems.slice(0, 50) } : { total: 0, items: [] },
      integrationFlags: can('infra.integrations') ? integrationFlags : { total: 0, items: [] },
      byPoc: can('infra.projects') ? byPoc : [],
      jobbag: {
        clients: can('jobbag.clients') ? clients : 0,
        vendors: can('jobbag.vendors') ? vendors : 0,
        vendorServices: can('jobbag.vendor-services') ? vendorServicesAll.length : 0,
        expiringSoon: can('jobbag.vendor-services') ? expiringSoon : 0,
        jobs: can('jobbag.jobs') ? jobs : 0,
        reminders: can('jobbag.reminders') ? reminders : 0,
      },
      generatedAt: now.toISOString(),
    };
  }
}

@UseGuards(JwtAuthGuard)
@Controller('dashboard')
class DashboardController {
  constructor(private readonly service: DashboardService) {}
  @Get('stats') stats(@CurrentUser() user: AuthUser) { return this.service.stats(buildAbility(user.permissions)); }
}

@Module({
  imports: [TypeOrmModule.forFeature([Server, Project, Environment, Integration, User, Client, Vendor, VendorSvc, Job, Reminder])],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
