import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventService } from './event.service';
import { EventController } from './event.controller';
import { Event, EventSchema } from '../schemas/event.schema';
import { TicketTier, TicketTierSchema } from '../schemas/ticket-tier.schema';
import { Tenant, TenantSchema } from '../schemas/tenant.schema';
import { Ticket, TicketSchema } from '../schemas/ticket.schema';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Event.name, schema: EventSchema },
      { name: TicketTier.name, schema: TicketTierSchema },
      { name: Tenant.name, schema: TenantSchema },
      { name: Ticket.name, schema: TicketSchema },
    ]),
    CloudinaryModule,
  ],
  controllers: [EventController],
  providers: [EventService],
  exports: [EventService],
})
export class EventModule {}
