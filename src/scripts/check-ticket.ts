import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Ticket } from '../schemas/ticket.schema';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const ticketModel = app.get<Model<Ticket>>(getModelToken(Ticket.name));

  const tickets = await ticketModel.find({ ticketNumber: { $regex: '^GT/' } }).sort({ ticketNumber: 1 }).exec();
  console.log(`Found ${tickets.length} GT tickets.`);
  tickets.forEach(t => console.log(`${t.ticketNumber} - TierId: ${t.tierId}`));

  await app.close();
}
bootstrap();
