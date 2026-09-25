import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Ticket } from '../schemas/ticket.schema';
import { TicketTier } from '../schemas/ticket-tier.schema';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const ticketModel = app.get<Model<Ticket>>(getModelToken(Ticket.name));
  const ticketTierModel = app.get<Model<TicketTier>>(getModelToken(TicketTier.name));

  const tiers = await ticketTierModel.find().exec();
  
  for (const tier of tiers) {
    const tickets = await ticketModel.find({ tierId: tier._id }).exec();
    
    let maxNumber = 0;
    
    for (const ticket of tickets) {
      if (!ticket.ticketNumber) continue;
      
      const match = ticket.ticketNumber.match(/\/T(\d+)\//);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNumber) {
          maxNumber = num;
        }
      }
    }
    
    if (tier.soldCount < maxNumber) {
      console.log(`Tier ${tier.name} (ID: ${tier._id}): soldCount is ${tier.soldCount}, but max ticket index is ${maxNumber}. Updating soldCount to ${maxNumber}...`);
      tier.soldCount = maxNumber;
      await tier.save();
      console.log(`Synced ${tier.name} soldCount to ${maxNumber}`);
    } else {
      console.log(`Tier ${tier.name} is fine. (soldCount: ${tier.soldCount}, maxIndex: ${maxNumber})`);
    }
  }

  await app.close();
}

bootstrap();
