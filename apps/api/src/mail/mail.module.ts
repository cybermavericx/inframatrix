import {
  Controller, Delete, Get, Injectable, Logger, Module, Param, ParseIntPipe, UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as https from 'https';
import * as nodemailer from 'nodemailer';
import { Outbox } from './entities/outbox.entity';
import { brandwrap } from './template';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

const RES = 'jobbag.outbox';

type Provider = 'smtp' | 'sendgrid' | null;

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly provider: Provider;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Outbox) private readonly outbox: Repository<Outbox>,
  ) {
    // Provider priority: SendGrid (HTTPS) -> SMTP (nodemailer) -> none (store only).
    if (config.get<string>('SENDGRID_API_KEY')) {
      this.provider = 'sendgrid';
    } else if (config.get<string>('MAIL_HOST')) {
      this.provider = 'smtp';
      this.transporter = nodemailer.createTransport({
        host: config.get<string>('MAIL_HOST'),
        port: Number(config.get('MAIL_PORT', 587)),
        secure: config.get('MAIL_SECURE', 'false') === 'true',
        auth: config.get('MAIL_USER')
          ? { user: config.get<string>('MAIL_USER'), pass: config.get<string>('MAIL_PASS') }
          : undefined,
      });
    } else {
      this.provider = null;
    }
  }

  private from(): string {
    return this.config.get<string>('MAIL_FROM', 'no-reply@inframatrix.local');
  }

  /**
   * Send (or store) an email. ALWAYS records an Outbox row first. Never throws — failures are
   * recorded as FAILED so callers (schedulers, invites) never crash on a mail problem.
   */
  async send(
    to: string,
    subject: string,
    html: string,
    meta?: { relatedType?: string; relatedId?: number },
  ): Promise<{ sent: boolean; outboxId: number }> {
    const row = await this.outbox.save(this.outbox.create({
      toAddr: to,
      subject,
      body: html,
      status: 'QUEUED',
      provider: this.provider,
      relatedType: meta?.relatedType ?? null,
      relatedId: meta?.relatedId ?? null,
    }));

    // No provider configured, or no recipient: keep the rendered mail as a viewable fallback only.
    if (!this.provider || !to) {
      row.status = 'STORED';
      await this.outbox.save(row);
      this.logger.log(`[DEV — stored only] "${subject}" -> ${to || '(no recipient)'} (outbox #${row.id})`);
      return { sent: false, outboxId: row.id };
    }

    try {
      if (this.provider === 'sendgrid') {
        await this.sendViaSendgrid(to, subject, html);
      } else {
        await this.transporter!.sendMail({ from: this.from(), to, subject, html });
      }
      row.status = 'SENT';
      row.sentAt = new Date();
      await this.outbox.save(row);
      return { sent: true, outboxId: row.id };
    } catch (e) {
      row.status = 'FAILED';
      row.error = e instanceof Error ? e.message : String(e);
      await this.outbox.save(row);
      this.logger.warn(`Mail send failed (outbox #${row.id}): ${row.error}`);
      return { sent: false, outboxId: row.id };
    }
  }

  /** POST to SendGrid's v3 API over Node's built-in https (no @sendgrid/mail dependency). */
  private sendViaSendgrid(to: string, subject: string, html: string): Promise<void> {
    const key = this.config.get<string>('SENDGRID_API_KEY')!;
    const recipients = to.split(',').map((s) => s.trim()).filter(Boolean).map((email) => ({ email }));
    const payload = JSON.stringify({
      personalizations: [{ to: recipients }],
      from: { email: this.from() },
      subject,
      content: [{ type: 'text/html', value: html }],
    });
    return new Promise<void>((resolve, reject) => {
      const req = https.request(
        {
          method: 'POST',
          hostname: 'api.sendgrid.com',
          path: '/v3/mail/send',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          let body = '';
          res.on('data', (c) => { body += c; });
          res.on('end', () => {
            if (status >= 200 && status < 300) resolve();
            else reject(new Error(`SendGrid ${status} ${res.statusMessage ?? ''}: ${body}`.trim()));
          });
        },
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  /** Build and send an invitation email. Backward-compatible signature. */
  async sendInvite(to: string, acceptUrl: string): Promise<{ sent: boolean }> {
    const html = brandwrap(
      'You are invited to InfraMatrix',
      `<p>You have been invited to <b>InfraMatrix</b>.</p>
       <p><a href="${acceptUrl}" style="color:#1f3a5f;font-weight:600;">Accept your invitation</a> (link expires in 7 days).</p>
       <p style="color:#9aa5b1;">Or paste this link into your browser:<br />${acceptUrl}</p>`,
    );
    const { sent } = await this.send(to, 'You have been invited to InfraMatrix', html, { relatedType: 'invite' });
    return { sent };
  }

  /** Build and send a "set your password" email (used for imported users + password resets). */
  async sendPasswordSetup(to: string, setupUrl: string): Promise<{ sent: boolean }> {
    const html = brandwrap(
      'Set your InfraMatrix password',
      `<p>An account has been set up for you on <b>InfraMatrix</b>.</p>
       <p><a href="${setupUrl}" style="color:#1f3a5f;font-weight:600;">Set your password</a> (link expires in 7 days).</p>
       <p style="color:#9aa5b1;">Or paste this link into your browser:<br />${setupUrl}</p>`,
    );
    const { sent } = await this.send(to, 'Set your InfraMatrix password', html, { relatedType: 'password-setup' });
    return { sent };
  }
}

@Injectable()
export class OutboxService {
  constructor(@InjectRepository(Outbox) private readonly repo: Repository<Outbox>) {}
  list(): Promise<Outbox[]> { return this.repo.find({ order: { id: 'DESC' }, take: 500 }); }
  findOne(id: number): Promise<Outbox | null> { return this.repo.findOne({ where: { id } }); }
  async remove(id: number) { await this.repo.delete(id); return { success: true }; }
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('jobbag/outbox')
export class OutboxController {
  constructor(private readonly service: OutboxService) {}
  @Get() @RequirePermission('read', RES) list() { return this.service.list(); }
  @Get(':id') @RequirePermission('read', RES) get(@Param('id', ParseIntPipe) id: number) { return this.service.findOne(id); }
  @Delete(':id') @RequirePermission('delete', RES) remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}

@Module({
  imports: [TypeOrmModule.forFeature([Outbox])],
  controllers: [OutboxController],
  providers: [MailService, OutboxService],
  exports: [MailService],
})
export class MailModule {}
