import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { TicketService } from '../ticket/ticket.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  
  const ticketService = app.get(TicketService);

  const ticketId = '6a8ae870b9d2d306b1953c53';

  console.log('Updating email for VIP ticket...');
  try {
    await ticketService.resendTicketEmail(ticketId, 'josephsolo2019@gmail.com');
    console.log(`Successfully updated and resent ticket ${ticketId} to josephsolo2019@gmail.com`);
  } catch (err) {
    console.error(`Failed to resend ticket ${ticketId}:`, err);
  }

  console.log('Finished processing.');
  await app.close();
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
