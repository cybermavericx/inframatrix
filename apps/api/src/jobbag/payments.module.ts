import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, Injectable, Module,
  NotFoundException, Param, ParseIntPipe, Patch, Post, UseGuards,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { DeepPartial, FindOptionsWhere } from 'typeorm';
import { randomUUID } from 'crypto';
import { Payment } from './entities/payment.entity';
import { CrudService } from '../common/crud.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

const RES = 'jobbag.payments';

@Injectable()
class PaymentsService extends CrudService<Payment> {
  constructor(@InjectRepository(Payment) repo: Repository<Payment>) {
    super(repo, ['vendorService', 'vendor', 'client'], [{ from: 'periodFrom', to: 'periodTo', label: 'Period to' }], 'payment');
  }

  /** advance a YYYY-MM-DD date by one cycle of the given frequency (roll-forward anchor).
   *  All math is in UTC so the returned date matches the input calendar date exactly (no TZ drift). */
  private advance(fromYmd: string, freq: string, customMonths?: number | null): string | null {
    const d = new Date(fromYmd + 'T00:00:00Z');
    switch (freq) {
      case 'WEEKLY': d.setUTCDate(d.getUTCDate() + 7); break;
      case 'MONTHLY': d.setUTCMonth(d.getUTCMonth() + 1); break;
      case 'QUARTERLY': d.setUTCMonth(d.getUTCMonth() + 3); break;
      case 'HALF_YEARLY': d.setUTCMonth(d.getUTCMonth() + 6); break;
      case 'YEARLY': d.setUTCFullYear(d.getUTCFullYear() + 1); break;
      case 'CUSTOM': if (!customMonths || customMonths <= 0) return null; d.setUTCMonth(d.getUTCMonth() + customMonths); break;
      default: return null;
    }
    return d.toISOString().slice(0, 10);
  }

  /**
   * Mark a payment paid and, if it's recurring, auto-create the next cycle anchored to the ACTUAL
   * paid date (so "due Jan 1, paid Jan 2" → next cycle starts from Jan 2). Stops at tenureEnd.
   * One Payment row per cycle = full history; spawnedNext guards against double-spawn.
   */
  async markPaid(id: number, paidDate?: string): Promise<{ paid: Payment; next: Payment | null }> {
    const p = await this.repo.findOne({ where: { id } as FindOptionsWhere<Payment> });
    if (!p) throw new NotFoundException('Payment not found');
    // Without this, a double-click (or a retried request after a network blip that actually succeeded)
    // silently overwrites the real paidDate with whatever's passed the second time — the first call's
    // recorded payment date gets quietly corrupted instead of the request just being rejected.
    if (p.status === 'paid') throw new ConflictException('This payment is already marked paid.');
    const paid = (paidDate && paidDate.trim()) || new Date().toISOString().slice(0, 10);
    p.status = 'paid';
    p.paidDate = paid;

    let next: Payment | null = null;
    if (p.frequency && p.frequency !== 'ONE_TIME' && !p.spawnedNext) {
      const nextDue = this.advance(paid, p.frequency, p.customMonths);
      if (nextDue && (!p.tenureEnd || nextDue <= p.tenureEnd)) {
        const series = p.seriesId || randomUUID();
        p.seriesId = series;
        next = await this.repo.save(this.repo.create({
          direction: p.direction, vendorServiceId: p.vendorServiceId ?? null, vendorId: p.vendorId ?? null,
          clientId: p.clientId ?? null, amount: p.amount ?? null, currency: p.currency ?? null,
          paymentMethod: p.paymentMethod ?? null, forWhat: p.forWhat ?? null,
          frequency: p.frequency, customMonths: p.customMonths ?? null, tenureEnd: p.tenureEnd ?? null,
          seriesId: series, dueDate: nextDue, status: 'due', spawnedNext: false, importUid: randomUUID(),
        } as DeepPartial<Payment>));
      }
      p.spawnedNext = true;
    }
    await this.repo.save(p);
    return { paid: p, next };
  }

  /** add `n` whole cycles to a YYYY-MM-DD date, clamping the day to the target month's length
   *  (e.g. Jan 31 + 1 month → Feb 28). UTC math, so no timezone drift. */
  private addCycle(fromYmd: string, freq: string, n: number, customMonths?: number | null): string | null {
    const d = new Date(fromYmd + 'T00:00:00Z');
    if (freq === 'WEEKLY') { d.setUTCDate(d.getUTCDate() + 7 * n); return d.toISOString().slice(0, 10); }
    const per: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 };
    const months = freq === 'CUSTOM' ? (customMonths ?? 0) : (per[freq] ?? 0);
    if (!months || months <= 0) return null;
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months * n);
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, lastDay));
    return d.toISOString().slice(0, 10);
  }

  private minusDay(ymd: string): string {
    const d = new Date(ymd + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Pre-create every remaining cycle of a recurring payment up to tenureEnd (inclusive), so the whole
   * contract is laid out as individual rows you can mark paid independently — instead of spawning the
   * next cycle one-at-a-time on payment.
   *
   * The seed row stays as cycle 1; this adds cycles 2..N. All rows (incl. the seed) get the shared
   * seriesId and spawnedNext=true, so marking any one paid never adds a duplicate "next" cycle.
   * Refuses if a series already exists for this payment (so it can't double-generate).
   */
  async generateSchedule(id: number): Promise<{ created: number; total: number; series: string }> {
    const p = await this.repo.findOne({ where: { id } as FindOptionsWhere<Payment> });
    if (!p) throw new NotFoundException('Payment not found');
    if (!p.frequency || p.frequency === 'ONE_TIME') {
      throw new BadRequestException('This payment does not repeat — set Repeats to a recurring frequency first.');
    }
    if (!p.tenureEnd) {
      throw new BadRequestException("Set 'Contract ends (stop repeating)' first so the schedule has an end date.");
    }
    if (p.seriesId || p.spawnedNext) {
      throw new ConflictException('A schedule already exists for this payment.');
    }
    const gateAnchor = p.dueDate ?? p.periodFrom;
    if (!gateAnchor) throw new BadRequestException('Set a Due date or Period from on the first payment first.');

    const series = randomUUID();
    const MAX = 600; // safety cap (~50 years monthly)
    const rows: Payment[] = [];
    let reachedTenureEnd = false;
    for (let n = 1; n <= MAX; n++) {
      const gate = this.addCycle(gateAnchor, p.frequency, n, p.customMonths);
      if (!gate) throw new BadRequestException('Could not compute the next cycle (check Repeats / Every N months).');
      if (gate > p.tenureEnd) { reachedTenureEnd = true; break; }
      const periodFrom = p.periodFrom ? this.addCycle(p.periodFrom, p.frequency, n, p.customMonths) : null;
      const nextStart = p.periodFrom ? this.addCycle(p.periodFrom, p.frequency, n + 1, p.customMonths) : null;
      const periodTo = p.periodFrom && nextStart ? this.minusDay(nextStart)
        : (p.periodTo ? this.addCycle(p.periodTo, p.frequency, n, p.customMonths) : null);
      const dueDate = p.dueDate ? this.addCycle(p.dueDate, p.frequency, n, p.customMonths) : periodFrom;
      rows.push(this.repo.create({
        direction: p.direction, vendorServiceId: p.vendorServiceId ?? null, vendorId: p.vendorId ?? null,
        clientId: p.clientId ?? null, amount: p.amount ?? null, currency: p.currency ?? null,
        paymentMethod: p.paymentMethod ?? null, forWhat: p.forWhat ?? null,
        frequency: p.frequency, customMonths: p.customMonths ?? null, tenureEnd: p.tenureEnd ?? null,
        seriesId: series, periodFrom, periodTo, dueDate, status: 'due', spawnedNext: true, importUid: randomUUID(),
      } as DeepPartial<Payment>));
    }
    // Without this, a contract span the safety cap can't fully cover (e.g. weekly for 15+ years) would
    // silently generate only the first ~600 cycles, mark the payment "scheduled" anyway, and never
    // surface that the schedule stops short of the real contract end — nothing else would ever revisit
    // it, since spawnedNext blocks the one-at-a-time markPaid path too.
    if (!reachedTenureEnd) {
      throw new BadRequestException(
        `This contract needs more than ${MAX} cycles to reach its end date — too long to auto-generate. Shorten "Contract ends", or leave the schedule unset and mark payments paid one at a time instead.`,
      );
    }
    // tie the seed into the series and mark it spawned so Mark-paid won't add a duplicate next cycle
    p.seriesId = series;
    p.spawnedNext = true;
    await this.repo.save(p);
    if (rows.length) await this.repo.save(rows);
    return { created: rows.length, total: rows.length + 1, series };
  }
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('jobbag/payments')
class PaymentsController {
  constructor(private readonly service: PaymentsService) {}
  @Get() @RequirePermission('read', RES) list() { return this.service.list(); }
  @Get(':id') @RequirePermission('read', RES) get(@Param('id', ParseIntPipe) id: number) { return this.service.findOne(id); }
  @Post() @RequirePermission('create', RES) create(@Body() dto: DeepPartial<Payment>) { return this.service.create(dto); }
  @Patch(':id') @RequirePermission('update', RES) update(@Param('id', ParseIntPipe) id: number, @Body() dto: DeepPartial<Payment>) { return this.service.update(id, dto); }
  /** mark paid (+ auto-create the next cycle if recurring); body may carry { paidDate } */
  @Post(':id/pay') @RequirePermission('update', RES) pay(@Param('id', ParseIntPipe) id: number, @Body() body: { paidDate?: string }) { return this.service.markPaid(id, body?.paidDate); }
  /** pre-create every remaining cycle up to the contract-end date (full schedule), each markable on its own */
  @Post(':id/schedule') @RequirePermission('update', RES) schedule(@Param('id', ParseIntPipe) id: number) { return this.service.generateSchedule(id); }
  @Delete(':id') @RequirePermission('delete', RES) remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}

@Module({
  imports: [TypeOrmModule.forFeature([Payment])],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
