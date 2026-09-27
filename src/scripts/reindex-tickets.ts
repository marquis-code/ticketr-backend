import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TicketTier } from '../schemas/ticket-tier.schema';
import { Ticket } from '../schemas/ticket.schema';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const ticketTierModel = app.get<Model<TicketTier>>(getModelToken(TicketTier.name));
  const ticketModel = app.get<Model<Ticket>>(getModelToken(Ticket.name));

  const tiers = await ticketTierModel.find().exec();

  for (const tier of tiers) {
    const tickets = await ticketModel.find({ tierId: tier._id }).sort({ createdAt: 1 }).exec();
    
    let index = 1;
    for (const ticket of tickets) {
      if (ticket.ticketNumber) {
        const parts = ticket.ticketNumber.split('/');
        if (parts.length === 3) {
          const prefix = parts[0];
          const suffix = parts[2];
          const formattedIndex = index < 10 ? `0${index}` : `${index}`;
          ticket.ticketNumber = `${prefix}/T${formattedIndex}/${suffix}`;
          await ticket.save();
        }
      }
      index++;
    }
    
    // Now set the soldCount to the exact actual count!
    tier.soldCount = tickets.length;
    await tier.save();
    console.log(`Re-indexed tier ${tier.name} to ${tickets.length} tickets. Set soldCount to ${tickets.length}.`);
  }

  await app.close();
}

bootstrap();
