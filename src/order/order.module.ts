import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { Order, OrderSchema } from '../schemas/order.schema';
import { TicketTier, TicketTierSchema } from '../schemas/ticket-tier.schema';
import { Event, EventSchema } from '../schemas/event.schema';
import { Tenant, TenantSchema } from '../schemas/tenant.schema';
import { Ticket, TicketSchema } from '../schemas/ticket.schema';
import { PaystackModule } from '../paystack/paystack.module';
import { ResendModule } from '../resend/resend.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: TicketTier.name, schema: TicketTierSchema },
      { name: Event.name, schema: EventSchema },
      { name: Tenant.name, schema: TenantSchema },
      { name: Ticket.name, schema: TicketSchema },
    ]),
    PaystackModule,
    ResendModule,
  ],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
