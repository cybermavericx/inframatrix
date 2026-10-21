import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RbacModule } from './rbac/rbac.module';
import { ServersModule } from './infra/servers.module';
import { ProjectsModule } from './infra/projects.module';
import { GitProvidersModule } from './infra/git-providers.module';
import { IntegrationTypesModule } from './infra/integration-types.module';
import { AccountsModule } from './infra/accounts.module';
import { EnvironmentsModule } from './infra/environments.module';
import { IntegrationsModule } from './infra/integrations.module';
import { InvitesModule } from './infra/invites.module';
import { DataModule } from './data/data.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { UploadsModule } from './uploads/uploads.module';
import { ClientsModule } from './jobbag/clients.module';
import { VendorsModule } from './jobbag/vendors.module';
import { VendorServicesModule } from './jobbag/vendor-services.module';
import { JobsModule } from './jobbag/jobs.module';
import { PaymentsModule } from './jobbag/payments.module';
import { RemindersModule } from './jobbag/reminders.module';
import { ReminderGroupsModule } from './jobbag/reminder-groups.module';
import { NotesModule } from './jobbag/notes.module';
import { AttachmentsModule } from './jobbag/attachments.module';
import { NotificationsModule } from './jobbag/notifications.module';
import { MailModule } from './mail/mail.module';
import { AuditModule } from './audit/audit.module';
import { TagsModule } from './tags/tags.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { ModuleGuard } from './common/guards/module.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RequestContextInterceptor } from './common/request-context.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql',
        host: config.get<string>('DB_HOST', '127.0.0.1'),
        port: config.get<number>('DB_PORT', 3306),
        username: config.get<string>('DB_USERNAME', 'root'),
        password: config.get<string>('DB_PASSWORD', ''),
        database: config.get<string>('DB_DATABASE', 'infra-jobbag'),
        charset: 'utf8mb4',
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    AuthModule,
    UsersModule,
    RbacModule,
    ServersModule,
    ProjectsModule,
    GitProvidersModule,
    IntegrationTypesModule,
    AccountsModule,
    EnvironmentsModule,
    IntegrationsModule,
    InvitesModule,
    ClientsModule,
    VendorsModule,
    VendorServicesModule,
    JobsModule,
    PaymentsModule,
    RemindersModule,
    ReminderGroupsModule,
    NotesModule,
    AttachmentsModule,
    NotificationsModule,
    MailModule,
    AuditModule,
    TagsModule,
    DataModule,
    DashboardModule,
    UploadsModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ModuleGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
  ],
})
export class AppModule {}
