import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Ticket } from '../schemas/ticket.schema';
import { Order, OrderStatus } from '../schemas/order.schema';
import { OrderService } from '../order/order.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const ticketModel = app.get<Model<Ticket>>(getModelToken(Ticket.name));
  const orderModel = app.get<Model<Order>>(getModelToken(Order.name));
  const orderService = app.get(OrderService);

  console.log('Finding PAID orders with missing tickets...');
  const paidOrders = await orderModel.find({ status: OrderStatus.PAID });
  let missingCount = 0;
  
  for (const order of paidOrders) {
    if (!order.items) {
      console.log(`Order ${order.orderNumber} has no items. Skipping...`);
      continue;
    }
    console.log(`Checking order ${order.orderNumber}...`);
    const existingTickets = await ticketModel.find({ orderId: order._id.toString() }).exec();
    const expectedTicketCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
    
    if (existingTickets.length < expectedTicketCount) {
      console.log(`Order ${order.orderNumber} (Ref: ${order.paystackReference}) has ${existingTickets.length}/${expectedTicketCount} tickets. Regenerating...`);
      missingCount++;
      try {
        const ref = order.paystackReference || order.orderNumber;
        await orderService.verifyAndFulfillOrder(`FORCE-PAID-${ref}`);
        console.log(`Successfully generated tickets for order ${order.orderNumber}`);
      } catch (err) {
        console.error(`Failed to generate tickets for order ${order.orderNumber}:`, err);
      }
    }
  }

  console.log(`\nFinished processing. Regenerated tickets for ${missingCount} orders.`);

  await app.close();
}

bootstrap();
