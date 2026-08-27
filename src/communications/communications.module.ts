import { Module } from '@nestjs/common';
import { CommunicationsController } from './communications.controller';
import { CommunicationsService } from './communications.service';
import { ResendModule } from '../resend/resend.module';
import { MongooseModule } from '@nestjs/mongoose';
import { TicketSchema } from '../schemas/ticket.schema';

@Module({
  imports: [
    ResendModule,
    MongooseModule.forFeature([{ name: 'Ticket', schema: TicketSchema }]),
  ],
  controllers: [CommunicationsController],
  providers: [CommunicationsService],
})
export class CommunicationsModule {}
