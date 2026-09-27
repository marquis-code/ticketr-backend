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

  const orderId = '6ab8f65d25b9da2dc75cb499'; // Nathan's order

  const originalOrder = await orderModel.findById(orderId);
  
  if (originalOrder && originalOrder.items[0].quantity === 2) {
    const item = originalOrder.items[0];
    const attendee1 = item.attendees![0]; // Eric
    const attendee2 = item.attendees![1]; // Nathan

    // Update original order to only have Nathan's ticket (or Eric's)
    // Let's make original order for Nathan, new order for Eric
    item.quantity = 1;
    item.subtotal = item.unitPrice;
    item.attendees = [attendee2];

    originalOrder.totalAmount = item.unitPrice;
    originalOrder.amountPaid = item.unitPrice;
    originalOrder.items = [item];
    await originalOrder.save();
    console.log('Updated original order to 100,000 for Nathan');

    // Create new order for Eric
    const newOrder = new orderModel({
      tenantId: originalOrder.tenantId,
      eventId: originalOrder.eventId,
      orderNumber: originalOrder.orderNumber + '-2',
      customerName: attendee1.name,
      customerEmail: attendee1.email,
      departmentCode: originalOrder.departmentCode,
      items: [{
        tierId: item.tierId,
        tierName: item.tierName,
        unitPrice: item.unitPrice,
        quantity: 1,
        subtotal: item.unitPrice,
        attendees: [attendee1]
      }],
      totalAmount: item.unitPrice,
      currency: originalOrder.currency,
      status: originalOrder.status,
      amountPaid: item.unitPrice,
      amountRemaining: 0,
      checkoutStep: originalOrder.checkoutStep,
      paymentMethod: originalOrder.paymentMethod,
      proofOfPaymentUrl: originalOrder.proofOfPaymentUrl,
      approvedBy: originalOrder.approvedBy,
      paidAt: originalOrder.paidAt
    });
    await newOrder.save();
    console.log('Created new order ' + newOrder.orderNumber + ' for 100,000 for Eric');

    // Also update tickets to point to correct orders
    const tickets = await ticketModel.find({ orderId: originalOrder._id });
    for (const t of tickets) {
      if (t.attendeeEmail === attendee1.email.toLowerCase()) {
        t.orderId = newOrder._id.toString();
        await t.save();
        console.log('Moved ticket ' + t.ticketNumber + ' to new order');
      }
    }
  }

  await app.close();
}

bootstrap();
