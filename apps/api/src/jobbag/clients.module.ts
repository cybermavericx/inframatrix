import {
  Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Patch, Post, UseGuards,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { DeepPartial } from 'typeorm';
import { Client } from './entities/client.entity';
import { Payment } from './entities/payment.entity';
import { CrudService } from '../common/crud.service';
import { blockedBy, paymentLabel, type Blocker } from '../common/blocked';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Injectable()
class ClientsService extends CrudService<Client> {
  constructor(
    @InjectRepository(Client) repo: Repository<Client>,
    @InjectRepository(Payment) private readonly payRepo: Repository<Payment>,
  ) {
    super(repo, [], [], 'client');
  }

  /** Clients + aggregates over their (incoming) payments so the list can be filtered by them:
   *  serviceNames (services billed to the client) and paymentStatuses. Arrays → match if ANY matches. */
  async listWithRelations() {
    const clients = await this.list();
    if (!clients.length) return clients;
    const ids = clients.map((c) => c.id);
    const payments = await this.payRepo.find({ where: { clientId: In(ids) }, relations: { vendorService: true } });
    const payBy = new Map<number, Payment[]>();
    for (const p of payments) { const k = p.clientId as number; (payBy.get(k) ?? payBy.set(k, []).get(k)!).push(p); }
    const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
    return clients.map((c) => {
      const ps = payBy.get(c.id) ?? [];
      return {
        ...c,
        serviceNames: uniq(ps.map((p) => p.vendorService?.serviceName)),
        paymentStatuses: uniq(ps.map((p) => p.status)),
      };
    });
  }

  /** Block delete while payments (incl. the client's billed services) still reference this client. */
  async remove(id: number) {
    const payments = await this.payRepo.find({ where: { clientId: id }, select: { id: true, amount: true, currency: true, direction: true, forWhat: true } });
    if (payments.length) {
      const blockers: Blocker[] = payments.map((p) => ({ resource: 'jobbag.payments', id: p.id, label: paymentLabel(p) }));
      throw blockedBy('client', blockers, 'Open each item below and delete it, then delete the client.');
    }
    return super.remove(id);
  }
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('jobbag/clients')
class ClientsController {
  constructor(private readonly service: ClientsService) {}
  @Get() @RequirePermission('read', 'jobbag.clients') list() { return this.service.listWithRelations(); }
  @Get(':id') @RequirePermission('read', 'jobbag.clients') get(@Param('id', ParseIntPipe) id: number) { return this.service.findOne(id); }
  @Post() @RequirePermission('create', 'jobbag.clients') create(@Body() dto: DeepPartial<Client>) { return this.service.create(dto); }
  @Patch(':id') @RequirePermission('update', 'jobbag.clients') update(@Param('id', ParseIntPipe) id: number, @Body() dto: DeepPartial<Client>) { return this.service.update(id, dto); }
  @Delete(':id') @RequirePermission('delete', 'jobbag.clients') remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}

@Module({
  imports: [TypeOrmModule.forFeature([Client, Payment])],
  controllers: [ClientsController],
  providers: [ClientsService],
})
export class ClientsModule {}
