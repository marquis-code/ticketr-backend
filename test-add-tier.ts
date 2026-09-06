import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { EventService } from './src/event/event.service';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const tierModel = app.get(getModelToken('TicketTier'));
  
  try {
    const newTier = await tierModel.create({
      eventId: new Types.ObjectId().toString(),
      name: 'Test Tier',
      description: '',
      price: 100,
      capacity: 100,
      maxPerPurchase: 5,
      markupFee: 0,
      markupFeeType: 'FLAT',
      markupStrategy: 'ADD_TO_FEE',
      isCoupleTicket: false,
    });
    console.log('Tier created successfully:', newTier);
  } catch (error) {
    console.error('Error creating tier:', error);
  }
  
  await app.close();
}
bootstrap();
