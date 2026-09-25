import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderStatus } from '../schemas/order.schema';
import { Ticket } from '../schemas/ticket.schema';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const orderModel = app.get<Model<Order>>(getModelToken(Order.name));
  const ticketModel = app.get<Model<Ticket>>(getModelToken(Ticket.name));

  const paidOrders = await orderModel.find({ status: OrderStatus.PAID }).exec();
  let missing = 0;
  for (const order of paidOrders) {
    if (!order.items) continue;
    const tickets = await ticketModel.find({ orderId: order._id.toString() }).exec();
    
    let ticketsToGenerate = 0;
    order.items.forEach(item => { ticketsToGenerate += item.quantity; });
    
    if (tickets.length < ticketsToGenerate) {
       console.log(`Order ${order.orderNumber} missing ${ticketsToGenerate - tickets.length} tickets`);
       missing++;
    }
  }
  
  if (missing === 0) {
    console.log('ALL PAID ORDERS HAVE THEIR TICKETS! YOU NAILED IT!');
  } else {
    console.log(`Found ${missing} orders with missing tickets.`);
  }

  await app.close();
}
bootstrap();
