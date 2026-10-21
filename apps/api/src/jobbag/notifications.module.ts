import { Body, Controller, Get, Injectable, Module, Post, UseGuards } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Between, In, LessThanOrEqual, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationLog } from './entities/notification.entity';
import { Reminder } from './entities/reminder.entity';
import { ReminderGroup } from './entities/reminder-group.entity';
import { VendorService } from './entities/vendor-service.entity';
import { Payment } from './entities/payment.entity';
import { User } from '../users/entities/user.entity';
import { MailModule, MailService } from '../mail/mail.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

const RES = 'jobbag.notifications';
const RETENTION_DAYS = 90;

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(NotificationLog) private readonly notif: Repository<NotificationLog>,
    @InjectRepository(Reminder) private readonly reminders: Repository<Reminder>,
    @InjectRepository(ReminderGroup) private readonly reminderGroups: Repository<ReminderGroup>,
    @InjectRepository(VendorService) private readonly vendorServices: Repository<VendorService>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly mail: MailService,
  ) {}

  private addMonths(d: Date, n: number) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }
  private addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  private ymd(d: Date) { return d.toISOString().slice(0, 10); }

  /** A reminder's `content` is free text anyone with create-reminder permission can set, but it ends
   *  up interpolated into an HTML email body AND stored verbatim in the Outbox, which is rendered with
   *  dangerouslySetInnerHTML in the app itself (RecordDetail.tsx) — unescaped, that's a stored-XSS path
   *  from "create a reminder" straight to "run script in whichever admin opens Outbox next". */
  private escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Resolve a reminder's recipients (selected users + members of selected groups + extra emails) to
   *  a deduped, comma-separated email string. */
  private async resolveRecipients(r: Reminder): Promise<string> {
    const userIds = new Set<number>((r.recipientUserIds ?? []).map(Number));
    if (r.recipientGroupIds?.length) {
      const groups = await this.reminderGroups.find({ where: { id: In(r.recipientGroupIds) } });
      for (const g of groups) for (const uid of g.memberUserIds ?? []) userIds.add(Number(uid));
    }
    const emails = new Set<string>();
    if (userIds.size) {
      const found = await this.users.find({ where: { id: In([...userIds]) } });
      for (const u of found) if (u.email) emails.add(u.email);
    }
    for (const e of (r.emailTo ?? '').split(',').map((s) => s.trim()).filter(Boolean)) emails.add(e);
    return [...emails].join(', ');
  }

  /** short human label for the kind of record a reminder is attached to */
  private parentLabel(parentType?: string | null): string {
    switch (parentType) {
      case 'payment': return 'Payment';
      case 'vendor_service': return 'Vendor service';
      case 'client': return 'Client';
      case 'vendor': return 'Vendor';
      case 'job': return 'Job';
      default: return 'Reminder';
    }
  }

  /**
   * Fire all WAITING reminders whose scheduled time has passed: email the recipients (always recorded
   * to the Outbox by MailService), then move the reminder to DUE (awaiting resolution). Recurrence is
   * NOT rotated here — the next occurrence is spawned when the reminder is *resolved*.
   */
  async runReminders(): Promise<number> {
    const now = new Date();
    const due = await this.reminders.find({ where: { status: 'WAITING', scheduledDateTime: LessThanOrEqual(now) } });
    for (const r of due) {
      const recipients = await this.resolveRecipients(r);
      const subject = `${r.title?.trim() || this.parentLabel(r.parentType) + ' reminder'}${r.parentId ? ` (#${r.parentId})` : ''}`;
      let status = recipients ? 'SENT' : 'SKIPPED';
      try {
        // MailService records every mail to the Outbox; STORED when no provider/recipient is configured
        const res = await this.mail.send(recipients, subject, `<p>${this.escapeHtml(r.content ?? '')}</p>`, { relatedType: 'reminder', relatedId: r.id });
        if (recipients && !res.sent) status = 'SENT'; // stored-only counts as handled (visible in Outbox)
      } catch {
        status = 'FAILED';
      }
      await this.notif.save(this.notif.create({
        source: 'REMINDER', subject, message: r.content ?? '',
        recipient: recipients, status, sentAt: now, reminderId: r.id,
      }));
      // move WAITING -> DUE (awaiting someone to Resolve it); recurrence spawns next on resolve
      r.status = 'DUE';
      r.firedAt = now;
      await this.reminders.save(r);
    }
    return due.length;
  }

  /** notify about renewable vendor-services expiring within 30 days (deduped per 7 days) */
  async runVendorExpiry(): Promise<number> {
    const now = new Date();
    const list = await this.vendorServices.find({ where: { isRenewable: 'Y', expiryDate: Between(this.ymd(now), this.ymd(this.addDays(now, 30))) }, relations: { vendor: true } });
    let n = 0;
    for (const s of list) {
      const vendorName = s.vendor?.vendorName ?? '';
      const subject = `Vendor service expiring: ${s.serviceName ?? (vendorName || '#' + s.id)}`;
      const recent = await this.notif.findOne({ where: { source: 'VENDOR_EXPIRY', subject, sentAt: Between(this.addDays(now, -7), now) } });
      if (recent) continue;
      await this.notif.save(this.notif.create({
        source: 'VENDOR_EXPIRY', subject,
        message: `${vendorName} / ${s.serviceName ?? ''} expires ${s.expiryDate ?? ''}`,
        status: 'SENT', sentAt: now,
      }));
      n++;
    }
    return n;
  }

  /** notify about payments that are due within 30 days (deduped per 7 days) */
  async runPaymentsDue(): Promise<number> {
    const now = new Date();
    const list = await this.payments.find({ where: { status: 'due', dueDate: Between(this.ymd(now), this.ymd(this.addDays(now, 30))) } });
    let n = 0;
    for (const p of list) {
      const subject = `Payment due (${p.direction}): ${p.forWhat ?? 'payment #' + p.id} — ${p.amount ?? ''} ${p.currency ?? ''}`;
      const recent = await this.notif.findOne({ where: { source: 'PAYMENT_DUE', subject, sentAt: Between(this.addDays(now, -7), now) } });
      if (recent) continue;
      await this.notif.save(this.notif.create({
        source: 'PAYMENT_DUE', subject,
        message: `Payment of ${p.amount ?? ''} ${p.currency ?? ''} due ${p.dueDate ?? ''}`,
        status: 'SENT', sentAt: now,
      }));
      n++;
    }
    return n;
  }

  async runAll() {
    return {
      reminders: await this.runReminders(),
      vendorExpiry: await this.runVendorExpiry(),
      paymentsDue: await this.runPaymentsDue(),
    };
  }

  /** rotation: drop old notification logs so the table doesn't grow forever */
  async purge(days = RETENTION_DAYS) {
    const res = await this.notif.delete({ sentAt: LessThanOrEqual(this.addDays(new Date(), -days)) } as never);
    return { deleted: res.affected ?? 0 };
  }

  list() { return this.notif.find({ order: { id: 'DESC' }, take: 500 }); }
}

@Injectable()
export class NotificationsScheduler {
  constructor(private readonly service: NotificationsService) {}

  @Cron(CronExpression.EVERY_HOUR, { timeZone: 'Asia/Dubai' })
  hourly() { return this.service.runReminders(); }

  @Cron(CronExpression.EVERY_DAY_AT_2AM, { timeZone: 'Asia/Dubai' })
  async daily() { await this.service.runVendorExpiry(); await this.service.runPaymentsDue(); await this.service.purge(); }
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('jobbag/notifications')
class NotificationsController {
  constructor(private readonly service: NotificationsService) {}
  @Get() @RequirePermission('read', RES) list() { return this.service.list(); }
  @Post('run') @RequirePermission('update', RES) run() { return this.service.runAll(); }
  @Post('purge') @RequirePermission('delete', RES) purge(@Body('days') days?: number) {
    // guard against missing/invalid/absurd values wiping or skewing the table
    const n = Number(days);
    const safeDays = Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 3650) : RETENTION_DAYS;
    return this.service.purge(safeDays);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([NotificationLog, Reminder, ReminderGroup, VendorService, Payment, User]), MailModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsScheduler],
})
export class NotificationsModule {}
