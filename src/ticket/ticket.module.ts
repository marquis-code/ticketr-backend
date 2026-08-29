import { Module } from '@nestjs/common';
import { TicketGeneratorModule } from '../ticket-generator/ticket-generator.module';
import { ResendModule } from '../resend/resend.module';
import { MongooseModule } from '@nestjs/mongoose';
import { TicketService } from './ticket.service';
import { TicketController } from './ticket.controller';
import { Ticket, TicketSchema } from '../schemas/ticket.schema';
import { Event, EventSchema } from '../schemas/event.schema';
import { TicketTier, TicketTierSchema } from '../schemas/ticket-tier.schema';
import { Order, OrderSchema } from '../schemas/order.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ticket.name, schema: TicketSchema },
      { name: Event.name, schema: EventSchema },
      { name: TicketTier.name, schema: TicketTierSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
    TicketGeneratorModule,
    ResendModule,
  ],
  controllers: [TicketController],
  providers: [TicketService],
  exports: [TicketService],
})
export class TicketModule {}
