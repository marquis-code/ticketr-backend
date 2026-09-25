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
    const actualCount = await ticketModel.countDocuments({ tierId: tier._id }).exec();
    
    if (tier.soldCount !== actualCount) {
      console.log(`Tier ${tier.name} (ID: ${tier._id}): soldCount is ${tier.soldCount}, but actual tickets in DB is ${actualCount}. Fixing...`);
      // Update the tier's soldCount
      tier.soldCount = actualCount;
      await tier.save();
      console.log(`Synced ${tier.name} soldCount to ${actualCount}`);
    } else {
      console.log(`Tier ${tier.name} is in sync (${actualCount} tickets)`);
    }
  }

  await app.close();
}

bootstrap();
