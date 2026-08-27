import { Module } from '@nestjs/common';
import { CommunicationsController } from './communications.controller';
import { CommunicationsService } from './communications.service';
import { ResendModule } from '../resend/resend.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { MongooseModule } from '@nestjs/mongoose';
import { TicketSchema } from '../schemas/ticket.schema';
import { CommunicationSchema } from '../schemas/communication.schema';

@Module({
  imports: [
    ResendModule,
    CloudinaryModule,
    MongooseModule.forFeature([
      { name: 'Ticket', schema: TicketSchema },
      { name: 'Communication', schema: CommunicationSchema }
    ]),
  ],
  controllers: [CommunicationsController],
  providers: [CommunicationsService],
})
export class CommunicationsModule {}
