import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PayoutService } from './payout.service';
import { PayoutController } from './payout.controller';
import { Payout, PayoutSchema } from '../schemas/payout.schema';
import { Order, OrderSchema } from '../schemas/order.schema';
import { Tenant, TenantSchema } from '../schemas/tenant.schema';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payout.name, schema: PayoutSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Tenant.name, schema: TenantSchema },
    ]),
    AuditModule,
  ],
  controllers: [PayoutController],
  providers: [PayoutService],
  exports: [PayoutService],
})
export class PayoutModule {}
