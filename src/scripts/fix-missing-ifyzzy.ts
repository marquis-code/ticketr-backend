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

  // We are only concerned with Party with ifyzzy event
  // Let's find orders for ndidiamarachi5@gmail.com
  
  const emailsToFix = ['ndidiamarachi5@gmail.com'];
  
  for (const email of emailsToFix) {
    const orders = await orderModel.find({ customerEmail: email, status: OrderStatus.PAID }).exec();
    for (const order of orders) {
       console.log(`Fulfilling order for ${email}: ${order.orderNumber}`);
       const ref = order.paystackReference || order.orderNumber;
       try {
         await orderService.verifyAndFulfillOrder(`FORCE-PAID-${ref}`);
         console.log(`Successfully generated ticket for ${email}`);
       } catch (e) {
         console.error(`Failed:`, e.message);
       }
    }
  }

  // Find any other paid orders for this event that are missing tickets
  // Event ID for Party with ifyzzy: 6aac5961c38166ac1f4b0ddc (or we can just check recent orders)
  const recentOrders = await orderModel.find({ status: OrderStatus.PAID }).sort({ createdAt: -1 }).limit(10).exec();
  for (const order of recentOrders) {
     if (!order.items) continue;
     const existingTickets = await ticketModel.find({ orderId: order._id.toString() }).exec();
     const expected = order.items.reduce((acc, item) => acc + item.quantity, 0);
     if (existingTickets.length < expected) {
         console.log(`Found another missing ticket! Order: ${order.orderNumber} Email: ${order.customerEmail}`);
         const ref = order.paystackReference || order.orderNumber;
         try {
           await orderService.verifyAndFulfillOrder(`FORCE-PAID-${ref}`);
           console.log(`Successfully generated ticket for ${order.customerEmail}`);
         } catch (e) {
           console.error(`Failed:`, e.message);
         }
     }
  }

  await app.close();
}

bootstrap();
