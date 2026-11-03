import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { OrderMaintenanceService } from './order-maintenance.service';
import { Order, OrderSchema } from '../schemas/order.schema';
import { TicketTier, TicketTierSchema } from '../schemas/ticket-tier.schema';
import { Event, EventSchema } from '../schemas/event.schema';
import { Tenant, TenantSchema } from '../schemas/tenant.schema';
import { Ticket, TicketSchema } from '../schemas/ticket.schema';
import { PaystackModule } from '../paystack/paystack.module';
import { ResendModule } from '../resend/resend.module';
import { AuditModule } from '../audit/audit.module';
import { TicketGeneratorModule } from '../ticket-generator/ticket-generator.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { TicketModule } from '../ticket/ticket.module';
import { Payout, PayoutSchema } from '../schemas/payout.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: TicketTier.name, schema: TicketTierSchema },
      { name: Event.name, schema: EventSchema },
      { name: Tenant.name, schema: TenantSchema },
      { name: Ticket.name, schema: TicketSchema },
      { name: Payout.name, schema: PayoutSchema },
    ]),
    PaystackModule,
    ResendModule,
    TicketGeneratorModule,
    CloudinaryModule,
    AuditModule,
    TicketModule,
  ],
  controllers: [OrderController],
  providers: [OrderService, OrderMaintenanceService],
  exports: [OrderService],
})
export class OrderModule {}
