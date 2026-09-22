import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order } from '../schemas/order.schema';
import { Ticket } from '../schemas/ticket.schema';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const orderModel = app.get<Model<Order>>(getModelToken(Order.name));
  const ticketModel = app.get<Model<Ticket>>(getModelToken(Ticket.name));

  const orderId = '6ab26a6579fb91dc10d752c1'; // Rufus's order

  // 2. Split the Order.
  // Original order is 150,000. Let's make it 100,000 and create a new one for 50,000.
  const originalOrder = await orderModel.findById(orderId);
  
  if (originalOrder && originalOrder.items.length > 1) {
    const guysItem = originalOrder.items.find(i => i.tierName.includes('Guys'));
    const girlsItem = originalOrder.items.find(i => i.tierName.includes('Girls'));

    // Update original order to only have Guys ticket
    if (guysItem && girlsItem) {
      originalOrder.items = [guysItem];
      originalOrder.totalAmount = 100000;
      originalOrder.amountPaid = 100000;
      await originalOrder.save();
      console.log('Updated original order to 100,000 for Guys Ticket');

      // Create new order for Girls ticket
      const newOrder = new orderModel({
        tenantId: originalOrder.tenantId,
        eventId: originalOrder.eventId,
        orderNumber: originalOrder.orderNumber + '-2',
        customerName: originalOrder.customerName,
        customerEmail: originalOrder.customerEmail,
        departmentCode: originalOrder.departmentCode,
        items: [girlsItem],
        totalAmount: 50000,
        currency: originalOrder.currency,
        status: originalOrder.status,
        amountPaid: 50000,
        amountRemaining: 0,
        checkoutStep: originalOrder.checkoutStep,
        paymentMethod: originalOrder.paymentMethod,
        proofOfPaymentUrl: originalOrder.proofOfPaymentUrl,
        approvedBy: originalOrder.approvedBy,
        paidAt: originalOrder.paidAt
      });
      await newOrder.save();
      console.log('Created new order ' + newOrder.orderNumber + ' for 50,000 for Girls Ticket');
    }
  }

  await app.close();
}

bootstrap();
