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

  const allTickets = await ticketModel.find().exec();
  for (const ticket of allTickets) {
    if (ticket.ticketNumber && !ticket.ticketNumber.includes('TEMP')) {
      ticket.ticketNumber = `${ticket.ticketNumber}-TEMP-${ticket._id.toString()}`;
      await ticket.save();
    }
  }

  for (const tier of tiers) {
    const tickets = await ticketModel.find({ tierId: tier._id }).sort({ createdAt: 1 }).exec();
    let index = 1;
    for (const ticket of tickets) {
      if (ticket.ticketNumber) {
        const cleanNumber = ticket.ticketNumber.split('-TEMP')[0];
        const parts = cleanNumber.split('/');
        if (parts.length === 3) {
          const suffix = parts[2];
          
          let tierPrefix = 'R';
          const name = tier.name.toUpperCase();
          if (name.includes('VVIP') || name.includes('VERY VIP')) tierPrefix = 'VV';
          else if (name.includes('VIP')) tierPrefix = 'V';
          else if (name.includes('REGULAR') || name.includes('STANDARD')) tierPrefix = 'R';
          else if (name.includes('STUDENT')) tierPrefix = 'S';
          else if (name.includes('GUYS') || name.includes('GUY')) tierPrefix = 'GT';
          else if (name.includes('GIRLS') || name.includes('GIRL')) tierPrefix = 'GRL';
          else tierPrefix = tier.name.split(' ').map((w) => w[0]).join('').toUpperCase().substring(0, 3) || 'R';

          const formattedIndex = index < 10 ? `0${index}` : `${index}`;
          ticket.ticketNumber = `${tierPrefix}/T${formattedIndex}/${suffix}`;
          await ticket.save();
        }
      }
      index++;
    }
    
    tier.soldCount = tickets.length;
    await tier.save();
    console.log(`Re-indexed tier ${tier.name} to ${tickets.length} tickets. Set soldCount to ${tickets.length}.`);
  }

  await app.close();
}

bootstrap();
