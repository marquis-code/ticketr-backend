import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Ticket } from '../schemas/ticket.schema';
import { Order, OrderStatus } from '../schemas/order.schema';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const ticketModel = app.get<Model<Ticket>>(getModelToken(Ticket.name));
  const orderModel = app.get<Model<Order>>(getModelToken(Order.name));

  console.log('Finding PAID orders with missing tickets...');
  const paidOrders = await orderModel.find({ status: OrderStatus.PAID }).exec();
  
  for (const order of paidOrders) {
    if (!order.items) continue;
    const existingTickets = await ticketModel.find({ orderId: order._id.toString() }).exec();
    const expectedTicketCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
    
    if (existingTickets.length < expectedTicketCount) {
      console.log(`Order ${order.orderNumber} (Ref: ${order.paystackReference}) has ${existingTickets.length}/${expectedTicketCount} tickets. Email: ${order.customerEmail}`);
    }
  }

  await app.close();
}

bootstrap();
