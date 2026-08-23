import * as dotenv from 'dotenv';
dotenv.config();
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TicketTier } from '../schemas/ticket-tier.schema';
import { Ticket } from '../schemas/ticket.schema';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const tierModel = app.get<Model<TicketTier>>(getModelToken(TicketTier.name));
  const ticketModel = app.get<Model<Ticket>>(getModelToken(Ticket.name));

  const tiers = await tierModel.find({ name: /couple/i });
  console.log('Tiers found:', tiers.map(t => ({ id: t._id, name: t.name, isCouple: t.isCoupleTicket })));
  
  const tickets = await ticketModel.find({ attendeeEmail: 'odulawatajudeen@gmail.com' });
  console.log('Tickets for Odulawa:', tickets.map(t => ({ id: t._id, ticketNumber: t.ticketNumber, name: t.attendeeName, tierId: t.tierId })));

  await app.close();
}

bootstrap();
