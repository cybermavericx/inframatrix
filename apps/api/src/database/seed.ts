import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { ModuleEntity } from '../rbac/entities/module.entity';
import { AppEntity } from '../rbac/entities/app.entity';
import { GroupEntity, GroupKind } from '../rbac/entities/group.entity';
import { PermissionEntity, PermissionAction } from '../rbac/entities/permission.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { PasswordReset } from '../auth/entities/password-reset.entity';
import { Server } from '../infra/entities/server.entity';
import { Project } from '../infra/entities/project.entity';
import { GitProvider } from '../infra/entities/git-provider.entity';
import { IntegrationType } from '../infra/entities/integration-type.entity';
import { Account } from '../infra/entities/account.entity';
import { Environment } from '../infra/entities/environment.entity';
import { Integration } from '../infra/entities/integration.entity';
import { Invite } from '../infra/entities/invite.entity';
import { Client } from '../jobbag/entities/client.entity';
import { Vendor } from '../jobbag/entities/vendor.entity';
import { VendorService } from '../jobbag/entities/vendor-service.entity';
import { Job } from '../jobbag/entities/job.entity';
import { Payment } from '../jobbag/entities/payment.entity';
import { Reminder } from '../jobbag/entities/reminder.entity';
import { ReminderGroup } from '../jobbag/entities/reminder-group.entity';
import { Note } from '../jobbag/entities/note.entity';
import { Attachment } from '../jobbag/entities/attachment.entity';
import { NotificationLog } from '../jobbag/entities/notification.entity';
import { Outbox } from '../mail/entities/outbox.entity';

dotenv.config();

const ds = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  username: process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_DATABASE ?? 'infra-jobbag',
  charset: 'utf8mb4',
  entities: [
    User, ModuleEntity, AppEntity, GroupEntity, PermissionEntity, RefreshToken, PasswordReset,
    Server, Project, GitProvider, IntegrationType, Account, Environment, Integration, Invite,
    Client, Vendor, VendorService, Job, Payment, Reminder, ReminderGroup, Note, Attachment, NotificationLog, Outbox,
  ],
  // PROD-SAFE: only wipe in dev. In production the seed creates/updates the schema without dropping.
  dropSchema: process.env.NODE_ENV !== 'production',
  synchronize: true,
});

async function run() {
  await ds.initialize();
  const moduleRepo = ds.getRepository(ModuleEntity);
  const appRepo = ds.getRepository(AppEntity);
  const permRepo = ds.getRepository(PermissionEntity);
  const groupRepo = ds.getRepository(GroupEntity);
  const userRepo = ds.getRepository(User);

  const upsertModule = async (data: Partial<ModuleEntity> & { key: string }) => {
    let m = await moduleRepo.findOne({ where: { key: data.key } });
    if (!m) m = moduleRepo.create();
    Object.assign(m, data);
    return moduleRepo.save(m);
  };

  const upsertApp = async (module: ModuleEntity, data: { key: string; label: string; sort: number }) => {
    let a = await appRepo.findOne({ where: { moduleId: module.id, key: data.key } });
    if (!a) a = appRepo.create();
    Object.assign(a, { ...data, moduleId: module.id });
    return appRepo.save(a);
  };

  const ensurePerm = async (resource: string, action: PermissionAction) => {
    let p = await permRepo.findOne({ where: { resource, action } });
    if (!p) p = await permRepo.save(permRepo.create({ resource, action }));
    return p;
  };

  const resourcePerms = async (resource: string) => ({
    read: await ensurePerm(resource, PermissionAction.Read),
    create: await ensurePerm(resource, PermissionAction.Create),
    update: await ensurePerm(resource, PermissionAction.Update),
    delete: await ensurePerm(resource, PermissionAction.Delete),
  });

  const upsertGroup = async (data: {
    key: string;
    label: string;
    kind: GroupKind;
    app: AppEntity | null;
    level: number | null;
    permissions?: PermissionEntity[];
    implies?: GroupEntity[];
  }) => {
    let g = await groupRepo.findOne({ where: { key: data.key }, relations: { permissions: true, implies: true } });
    if (!g) g = groupRepo.create();
    g.key = data.key;
    g.label = data.label;
    g.kind = data.kind;
    g.level = data.level;
    g.appId = data.app ? data.app.id : null;
    g.permissions = data.permissions ?? [];
    g.implies = data.implies ?? [];
    return groupRepo.save(g);
  };

  // --- modules ---
  const infra = await upsertModule({ key: 'infra', label: 'Infra', icon: 'server', route: '/infra', sort: 1 });
  const jobbag = await upsertModule({ key: 'jobbag', label: 'JobBag', icon: 'briefcase', route: '/jobbag', sort: 2 });

  // --- apps ---
  const appsDef = [
    { module: infra, key: 'servers', label: 'Servers', sort: 1 },
    { module: infra, key: 'git-providers', label: 'Git Providers', sort: 2 },
    { module: infra, key: 'integration-types', label: 'Integration Types', sort: 3 },
    { module: infra, key: 'accounts', label: 'Accounts', sort: 4 },
    { module: infra, key: 'projects', label: 'Projects', sort: 5 },
    { module: infra, key: 'environments', label: 'Environments', sort: 6 },
    { module: infra, key: 'integrations', label: 'Integrations', sort: 7 },
    { module: infra, key: 'invites', label: 'Invites', sort: 8 },
    { module: infra, key: 'tags', label: 'Tags', sort: 9 },
    { module: jobbag, key: 'clients', label: 'Clients', sort: 1 },
    { module: jobbag, key: 'jobs', label: 'Jobs', sort: 2 },
    { module: jobbag, key: 'vendors', label: 'Vendors', sort: 3 },
    { module: jobbag, key: 'vendor-services', label: 'Vendor Services', sort: 4 },
    { module: jobbag, key: 'payments', label: 'Payments', sort: 5 },
    { module: jobbag, key: 'reminders', label: 'Reminders', sort: 6 },
    { module: jobbag, key: 'notes', label: 'Notes', sort: 7 },
    { module: jobbag, key: 'outbox', label: 'Outbox', sort: 8 },
    { module: jobbag, key: 'notifications', label: 'Notifications', sort: 9 },
    { module: jobbag, key: 'attachments', label: 'Attachments', sort: 10 },
  ];
  const apps: Record<string, AppEntity> = {};
  for (const d of appsDef) {
    apps[`${d.module.key}.${d.key}`] = await upsertApp(d.module, { key: d.key, label: d.label, sort: d.sort });
  }

  // --- core: user administration (standalone group) ---
  const coreUsers = await resourcePerms('core.users');
  const coreAdmin = await upsertGroup({
    key: 'core.admin',
    label: 'Administration: Settings',
    kind: GroupKind.Standalone,
    app: null,
    level: null,
    permissions: Object.values(coreUsers),
  });

  const adminGroups: GroupEntity[] = [coreAdmin];

  // --- per-app leveled groups (Viewer < Editor < Admin) with implications ---
  for (const key of Object.keys(apps)) {
    const app = apps[key];
    const p = await resourcePerms(key);
    const viewer = await upsertGroup({
      key: `${key}.viewer`, label: `${app.label}: Viewer`, kind: GroupKind.Level, app, level: 1,
      permissions: [p.read],
    });
    const editor = await upsertGroup({
      key: `${key}.editor`, label: `${app.label}: Editor`, kind: GroupKind.Level, app, level: 2,
      permissions: [p.read, p.create, p.update], implies: [viewer],
    });
    const admin = await upsertGroup({
      key: `${key}.admin`, label: `${app.label}: Admin`, kind: GroupKind.Level, app, level: 3,
      permissions: Object.values(p), implies: [editor, viewer],
    });
    adminGroups.push(admin);
  }

  // --- standalone checkbox example ---
  await upsertGroup({
    key: 'jobbag.export', label: 'JobBag: Access to export', kind: GroupKind.Standalone,
    app: apps['jobbag.jobs'], level: null, permissions: [],
  });

  // --- admin user (full access to both modules) ---
  const email = 'admin@infra-v2.local';
  const password = 'Admin@123';
  let admin = await userRepo.findOne({ where: { email }, relations: { modules: true, groups: true } });
  if (!admin) {
    admin = userRepo.create({
      name: 'Administrator',
      email,
      password: await bcrypt.hash(password, 10),
      status: 'Y',
    });
  }
  admin.modules = [infra, jobbag];
  admin.groups = adminGroups;
  await userRepo.save(admin);

  console.log('Seed complete.');
  console.log(`Admin login: ${email} / ${password}`);
  await ds.destroy();
}

run().catch(async (err) => {
  console.error(err);
  try {
    await ds.destroy();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
