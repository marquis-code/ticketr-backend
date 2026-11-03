import { Module } from '@nestjs/common';
import { TicketGeneratorModule } from '../ticket-generator/ticket-generator.module';
import { ResendModule } from '../resend/resend.module';
import { PaystackModule } from '../paystack/paystack.module';
import { MongooseModule } from '@nestjs/mongoose';
import { TicketService } from './ticket.service';
import { TicketController } from './ticket.controller';
import { Ticket, TicketSchema } from '../schemas/ticket.schema';
import { Event, EventSchema } from '../schemas/event.schema';
import { TicketTier, TicketTierSchema } from '../schemas/ticket-tier.schema';
import { Order, OrderSchema } from '../schemas/order.schema';
import { Tenant, TenantSchema } from '../schemas/tenant.schema';
import { ResaleListing, ResaleListingSchema } from '../schemas/resale-listing.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ticket.name, schema: TicketSchema },
      { name: Event.name, schema: EventSchema },
      { name: TicketTier.name, schema: TicketTierSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Tenant.name, schema: TenantSchema },
      { name: ResaleListing.name, schema: ResaleListingSchema },
    ]),
    TicketGeneratorModule,
    ResendModule,
    PaystackModule,
  ],
  controllers: [TicketController],
  providers: [TicketService],
  exports: [TicketService],
})
export class TicketModule {}
