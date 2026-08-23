import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OrderDocument, OrderStatus } from '../schemas/order.schema';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const orderModel = app.get<Model<OrderDocument>>(getModelToken('Order'));

  console.log('Finding pending orders...');
  
  const pendingOrders = await orderModel.find({ 
    status: { $in: [OrderStatus.PENDING, OrderStatus.AWAITING_APPROVAL] } 
  }).sort({ createdAt: -1 }).exec();

  const ordersByEmailAndEvent = new Map<string, any[]>();

  for (const order of pendingOrders) {
    const key = `${order.customerEmail}-${order.eventId}`;
    if (!ordersByEmailAndEvent.has(key)) {
      ordersByEmailAndEvent.set(key, []);
    }
    ordersByEmailAndEvent.get(key)!.push(order);
  }

  let deletedCount = 0;

  for (const [key, orders] of ordersByEmailAndEvent.entries()) {
    if (orders.length > 1) {
      // Keep the first one (most recent, because of sort), delete the rest
      const [keptOrder, ...duplicateOrders] = orders;
      
      console.log(`Found ${duplicateOrders.length} duplicates for ${key}. Keeping order ${keptOrder.orderNumber}`);
      
      for (const dup of duplicateOrders) {
        await orderModel.deleteOne({ _id: dup._id });
        console.log(`Deleted duplicate order ${dup.orderNumber}`);
        deletedCount++;
      }
    }
  }

  console.log(`Finished! Deleted ${deletedCount} duplicate orders.`);
  
  await app.close();
}

bootstrap();
