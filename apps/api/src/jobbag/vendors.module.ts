import {
  Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Patch, Post, UseGuards,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { DeepPartial } from 'typeorm';
import { Vendor } from './entities/vendor.entity';
import { VendorService } from './entities/vendor-service.entity';
import { Payment } from './entities/payment.entity';
import { CrudService } from '../common/crud.service';
import { blockedBy, paymentLabel, type Blocker } from '../common/blocked';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Injectable()
class VendorsService extends CrudService<Vendor> {
  constructor(
    @InjectRepository(Vendor) repo: Repository<Vendor>,
    @InjectRepository(VendorService) private readonly vsRepo: Repository<VendorService>,
    @InjectRepository(Payment) private readonly payRepo: Repository<Payment>,
  ) {
    super(repo, [], [], 'vendor');
  }

  /** Vendors + aggregates over their child records so the list can be filtered/searched by them:
   *  serviceNames/Statuses/Expiries (its services) and paymentStatuses/Directions (its payments).
   *  Each is an array → the Custom Filter matches a vendor if ANY child matches. Batched (no N+1). */
  async listWithRelations() {
    const vendors = await this.list();
    if (!vendors.length) return vendors;
    const ids = vendors.map((v) => v.id);
    const services = await this.vsRepo.find({ where: { vendorId: In(ids) }, select: { id: true, vendorId: true, serviceName: true, status: true, expiryDate: true } });
    const payments = await this.payRepo.find({ where: { vendorId: In(ids) }, select: { id: true, vendorId: true, status: true, direction: true } });
    const svcBy = new Map<number, VendorService[]>();
    for (const s of services) { const k = s.vendorId as number; (svcBy.get(k) ?? svcBy.set(k, []).get(k)!).push(s); }
    const payBy = new Map<number, Payment[]>();
    for (const p of payments) { const k = p.vendorId as number; (payBy.get(k) ?? payBy.set(k, []).get(k)!).push(p); }
    const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
    return vendors.map((v) => {
      const ss = svcBy.get(v.id) ?? [];
      const ps = payBy.get(v.id) ?? [];
      return {
        ...v,
        serviceNames: uniq(ss.map((s) => s.serviceName)),
        serviceStatuses: uniq(ss.map((s) => s.status)),
        serviceExpiries: uniq(ss.map((s) => (s.expiryDate ? String(s.expiryDate) : null))),
        paymentStatuses: uniq(ps.map((p) => p.status)),
        paymentDirections: uniq(ps.map((p) => p.direction)),
      };
    });
  }

  /** Restrict policy: block delete while the vendor still has services or payments; delete those first. */
  async remove(id: number) {
    const services = await this.vsRepo.find({ where: { vendorId: id }, select: { id: true, serviceName: true } });
    const payments = await this.payRepo.find({ where: { vendorId: id }, select: { id: true, amount: true, currency: true, direction: true, forWhat: true } });
    if (services.length || payments.length) {
      const blockers: Blocker[] = [
        ...services.map((s) => ({ resource: 'jobbag.vendor-services', id: s.id, label: s.serviceName || `Service #${s.id}` })),
        ...payments.map((p) => ({ resource: 'jobbag.payments', id: p.id, label: paymentLabel(p) })),
      ];
      throw blockedBy('vendor', blockers, 'Open each item below and delete it, then delete the vendor.');
    }
    return super.remove(id);
  }
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('jobbag/vendors')
class VendorsController {
  constructor(private readonly service: VendorsService) {}
  @Get() @RequirePermission('read', 'jobbag.vendors') list() { return this.service.listWithRelations(); }
  @Get(':id') @RequirePermission('read', 'jobbag.vendors') get(@Param('id', ParseIntPipe) id: number) { return this.service.findOne(id); }
  @Post() @RequirePermission('create', 'jobbag.vendors') create(@Body() dto: DeepPartial<Vendor>) { return this.service.create(dto); }
  @Patch(':id') @RequirePermission('update', 'jobbag.vendors') update(@Param('id', ParseIntPipe) id: number, @Body() dto: DeepPartial<Vendor>) { return this.service.update(id, dto); }
  @Delete(':id') @RequirePermission('delete', 'jobbag.vendors') remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}

@Module({
  imports: [TypeOrmModule.forFeature([Vendor, VendorService, Payment])],
  controllers: [VendorsController],
  providers: [VendorsService],
})
export class VendorsModule {}
