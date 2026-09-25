import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Ticket } from '../schemas/ticket.schema';
import { Order } from '../schemas/order.schema';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const ticketModel = app.get<Model<Ticket>>(getModelToken(Ticket.name));
  const orderModel = app.get<Model<Order>>(getModelToken(Order.name));

  const emails = ['classicoluwadare90@gmail.com', 'ndidiamarachi5@gmail.com'];
  
  for (const email of emails) {
    console.log(`\n--- Investigating ${email} ---`);
    const orders = await orderModel.find({ customerEmail: email });
    console.log(`Orders found: ${orders.length}`);
    for (const order of orders) {
      console.log(`- Order ${order._id}: Status=${order.status}, Amount=${(order as any).totalAmount}, Items:`, JSON.stringify(order.items));
    }

    const tickets = await ticketModel.find({ attendeeEmail: email });
    console.log(`Tickets found: ${tickets.length}`);
    for (const ticket of tickets) {
       console.log(`- Ticket ${ticket.ticketNumber}: Status=${ticket.status}, OrderId=${ticket.orderId}`);
    }
  }

  // Also let's check total counts for the event
  // Let's get the event id for "Party with ifyzzy and cee63"
  const ticketsCount = await ticketModel.countDocuments();
  const ordersCount = await orderModel.countDocuments();
  console.log(`\nTOTAL TICKETS IN DB: ${ticketsCount}`);
  console.log(`TOTAL ORDERS IN DB: ${ordersCount}`);

  await app.close();
}

bootstrap();
