import { Module } from '@nestjs/common';
import { TicketGeneratorService } from './ticket-generator.service';

@Module({
  providers: [TicketGeneratorService],
  exports: [TicketGeneratorService],
})
export class TicketGeneratorModule {}
