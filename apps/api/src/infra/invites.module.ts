import {
  Body, Controller, Delete, Get, Injectable, Module, NotFoundException, Param, ParseIntPipe, Post, UseGuards,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { Invite } from './entities/invite.entity';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { Public } from '../common/decorators/public.decorator';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/users.service';
import { MailModule, MailService } from '../mail/mail.module';

const RES = 'core.users';

interface InviteDto { email: string; moduleKeys?: string[]; groupKeys?: string[] }
interface AcceptDto { name: string; password: string }

@Injectable()
class InvitesService {
  constructor(
    @InjectRepository(Invite) private readonly repo: Repository<Invite>,
    private readonly users: UsersService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  list() {
    return this.repo.find({ order: { id: 'DESC' } });
  }

  async create(dto: InviteDto) {
    const token = randomBytes(24).toString('hex');
    const invite = await this.repo.save(
      this.repo.create({
        email: dto.email,
        token,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        moduleKeys: JSON.stringify(dto.moduleKeys ?? []),
        groupKeys: JSON.stringify(dto.groupKeys ?? []),
      }),
    );
    const webBase = (this.config.get<string>('WEB_ORIGIN') ?? 'http://localhost:5173').split(',')[0].trim();
    const acceptUrl = `${webBase}/accept/${token}`;
    const res = await this.mail.sendInvite(dto.email, acceptUrl);
    return { ...invite, acceptUrl, emailSent: res.sent };
  }

  async remove(id: number) {
    await this.repo.delete(id);
    return { success: true };
  }

  /**
   * Create a "set your password" link for each existing user (used to onboard imported users and for
   * password resets). Emails the link when a mail provider is configured; the returned `url` lets the
   * admin copy/share it otherwise. Reuses the invite token store; `set-password` (below) consumes it.
   */
  async createPasswordSetups(userIds: number[]) {
    const webBase = (this.config.get<string>('WEB_ORIGIN') ?? 'http://localhost:5173').split(',')[0].trim();
    const results: { userId: number; email: string | null; name: string | null; url: string | null; emailSent: boolean; error?: string }[] = [];
    for (const id of [...new Set(userIds)]) {
      let user;
      try { user = await this.users.findOne(id); }
      catch { results.push({ userId: id, email: null, name: null, url: null, emailSent: false, error: 'User not found' }); continue; }
      const token = randomBytes(24).toString('hex');
      await this.repo.save(this.repo.create({
        email: user.email, token, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }));
      const url = `${webBase}/reset/${token}`;
      const res = await this.mail.sendPasswordSetup(user.email, url);
      results.push({ userId: id, email: user.email, name: user.name, url, emailSent: res.sent });
    }
    return { results };
  }

  /** Consume a setup/reset token: set the password on the EXISTING user with that email. */
  async setPassword(token: string, password: string) {
    if (!password || password.length < 6) throw new NotFoundException('Password must be at least 6 characters.');
    const inv = await this.repo.findOne({ where: { token } });
    if (this.invalid(inv)) throw new NotFoundException('This link is invalid or has expired');
    const user = await this.users.findByEmail(inv!.email);
    if (!user) throw new NotFoundException('No account found for this link');
    await this.users.update(user.id, { password });
    inv!.acceptedAt = new Date();
    await this.repo.save(inv!);
    return { success: true };
  }

  private invalid(inv: Invite | null): boolean {
    return !inv || !!inv.acceptedAt || !!(inv.expiresAt && inv.expiresAt < new Date());
  }

  async getByToken(token: string) {
    const inv = await this.repo.findOne({ where: { token } });
    if (this.invalid(inv)) return { valid: false };
    return { valid: true, email: inv!.email };
  }

  async accept(token: string, body: AcceptDto) {
    const inv = await this.repo.findOne({ where: { token } });
    if (this.invalid(inv)) throw new NotFoundException('Invite is invalid or has expired');
    await this.users.create({
      name: body.name,
      email: inv!.email,
      password: body.password,
      moduleKeys: JSON.parse(inv!.moduleKeys ?? '[]'),
      groupKeys: JSON.parse(inv!.groupKeys ?? '[]'),
    });
    inv!.acceptedAt = new Date();
    await this.repo.save(inv!);
    return { success: true };
  }
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('invites')
class InvitesController {
  constructor(private readonly service: InvitesService) {}
  @Get() @RequirePermission('read', RES) list() { return this.service.list(); }
  @Post() @RequirePermission('create', RES) create(@Body() dto: InviteDto) { return this.service.create(dto); }
  @Post('password-setup') @RequirePermission('update', RES) passwordSetups(@Body() dto: { userIds: number[] }) { return this.service.createPasswordSetups(dto.userIds ?? []); }
  @Delete(':id') @RequirePermission('delete', RES) remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}

@Controller('public/invites')
class PublicInvitesController {
  constructor(private readonly service: InvitesService) {}
  @Public() @Get(':token') get(@Param('token') token: string) { return this.service.getByToken(token); }
  @Public() @Post(':token/accept') accept(@Param('token') token: string, @Body() body: AcceptDto) { return this.service.accept(token, body); }
  @Public() @Post(':token/set-password') setPassword(@Param('token') token: string, @Body() body: { password: string }) { return this.service.setPassword(token, body.password); }
}

@Module({
  imports: [TypeOrmModule.forFeature([Invite]), UsersModule, MailModule],
  controllers: [InvitesController, PublicInvitesController],
  providers: [InvitesService],
})
export class InvitesModule {}
