import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { TicketService } from './src/ticket/ticket.service';
import { Model } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const ticketService = app.get(TicketService);
  const ticketModel = app.get<Model<any>>(getModelToken('Ticket'));
  const tierModel = app.get<Model<any>>(getModelToken('TicketTier'));

  const emails = [
    'oluwoleakanni2000@gmail.com',
    'preciousoladipupo97@gmail.com',
    'ajoy40734@gmail.com',
    'ayegbusidelaide@gmail.com'
  ];

  for (const email of emails) {
    const tickets = await ticketModel.find({ attendeeEmail: { $regex: new RegExp(`^${email}$`, 'i') } });
    console.log(`\nEmail: ${email}`);
    if (tickets.length === 0) {
      console.log('  Status: Not found');
      continue;
    }
    
    for (const t of tickets) {
      const tier = await tierModel.findById(t.tierId);
      console.log(`  Ticket ID: ${t._id}`);
      console.log(`  Ticket Type (Tier): ${tier ? tier.name : 'Unknown'}`);
      console.log(`  Payment Status: ${t.status}`);
      
      try {
        await ticketService.resendTicketEmail(t._id.toString());
        console.log(`  Resend Status: Success`);
      } catch (err) {
        console.log(`  Resend Status: Failed - ${err.message}`);
      }
    }
  }

  await app.close();
  process.exit(0);
}
bootstrap();
