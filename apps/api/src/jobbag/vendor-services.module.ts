import {
  Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Patch, Post, UseGuards,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { DeepPartial } from 'typeorm';
import { VendorService } from './entities/vendor-service.entity';
import { Payment } from './entities/payment.entity';
import { CrudService } from '../common/crud.service';
import { blockedBy, paymentLabel, type Blocker } from '../common/blocked';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

const RES = 'jobbag.vendor-services';

@Injectable()
class VendorServicesService extends CrudService<VendorService> {
  constructor(
    @InjectRepository(VendorService) repo: Repository<VendorService>,
    @InjectRepository(Payment) private readonly payRepo: Repository<Payment>,
  ) {
    super(repo, ['vendor'], [{ from: 'startDate', to: 'expiryDate', label: 'Expiry date' }], 'vendor_service');
  }

  /** Services (+ their vendor) + aggregates over the payments on each service so the list can be
   *  filtered by them: paymentStatuses / paymentDirections and clientNames (clients billed for it).
   *  Each is an array → matches if ANY payment/client matches. Batched (no N+1). */
  async listWithRelations() {
    const services = await this.list();
    if (!services.length) return services;
    const ids = services.map((s) => s.id);
    const payments = await this.payRepo.find({ where: { vendorServiceId: In(ids) }, relations: { client: true } });
    const payBy = new Map<number, Payment[]>();
    for (const p of payments) { const k = p.vendorServiceId as number; (payBy.get(k) ?? payBy.set(k, []).get(k)!).push(p); }
    const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
    return services.map((s) => {
      const ps = payBy.get(s.id) ?? [];
      return {
        ...s,
        paymentStatuses: uniq(ps.map((p) => p.status)),
        paymentDirections: uniq(ps.map((p) => p.direction)),
        clientNames: uniq(ps.map((p) => p.client?.name)),
      };
    });
  }

  /** Block delete while payments (vendor cost or client billing) still reference this service. */
  async remove(id: number) {
    const payments = await this.payRepo.find({ where: { vendorServiceId: id }, select: { id: true, amount: true, currency: true, direction: true, forWhat: true } });
    if (payments.length) {
      const blockers: Blocker[] = payments.map((p) => ({ resource: 'jobbag.payments', id: p.id, label: paymentLabel(p) }));
      throw blockedBy('service', blockers, 'Open each item below and delete it, then delete the service.');
    }
    return super.remove(id);
  }
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('jobbag/vendor-services')
class VendorServicesController {
  constructor(private readonly service: VendorServicesService) {}
  @Get() @RequirePermission('read', RES) list() { return this.service.listWithRelations(); }
  @Get(':id') @RequirePermission('read', RES) get(@Param('id', ParseIntPipe) id: number) { return this.service.findOne(id); }
  @Post() @RequirePermission('create', RES) create(@Body() dto: DeepPartial<VendorService>) { return this.service.create(dto); }
  @Patch(':id') @RequirePermission('update', RES) update(@Param('id', ParseIntPipe) id: number, @Body() dto: DeepPartial<VendorService>) { return this.service.update(id, dto); }
  @Delete(':id') @RequirePermission('delete', RES) remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}

@Module({
  imports: [TypeOrmModule.forFeature([VendorService, Payment])],
  controllers: [VendorServicesController],
  providers: [VendorServicesService],
})
export class VendorServicesModule {}
