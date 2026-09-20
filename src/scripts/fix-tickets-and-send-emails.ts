import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderStatus } from '../schemas/order.schema';
import { Ticket } from '../schemas/ticket.schema';
import { ResendService } from '../resend/resend.service';
import { TicketService } from '../ticket/ticket.service';

async function bootstrap() {
  console.log('Bootstrapping NestJS context for data fix...');
  const app = await NestFactory.createApplicationContext(AppModule);
  
  const orderModel = app.get<Model<Order>>(getModelToken(Order.name));
  const ticketModel = app.get<Model<Ticket>>(getModelToken(Ticket.name));
  const resendService = app.get(ResendService);
  const ticketService = app.get(TicketService);

  console.log('Connected to application services.');

  // --- 1. Fix Chukwuemeka's Order ---
  const chukwuOrder = await orderModel.findOne({ orderNumber: "CMT-MU70JO1L-WGWE" });
  if (chukwuOrder && chukwuOrder.totalAmount === 200000) {
    console.log(`Found Chukwuemeka's order: ${chukwuOrder._id}. Splitting it...`);

    const chukwuTickets = await ticketModel.find({ orderId: chukwuOrder._id });
    
    if (chukwuTickets.length === 2) {
      // Modify original order to 1 ticket
      const newItems1 = JSON.parse(JSON.stringify(chukwuOrder.items));
      newItems1[0].quantity = 1;
      newItems1[0].subtotal = 100000;
      newItems1[0].attendees = [newItems1[0].attendees[0]];
      
      await orderModel.updateOne(
        { _id: chukwuOrder._id },
        { $set: { totalAmount: 100000, amountPaid: 100000, items: newItems1 } }
      );

      // Create a second order for the 2nd ticket
      const newOrderData = JSON.parse(JSON.stringify(chukwuOrder.toObject()));
      delete newOrderData._id;
      newOrderData.orderNumber = "CMT-MU70JO1L-WGW2"; // Variation for uniqueness
      newOrderData.totalAmount = 100000;
      newOrderData.amountPaid = 100000;
      const newItems2 = JSON.parse(JSON.stringify(chukwuOrder.items));
      newItems2[0].quantity = 1;
      newItems2[0].subtotal = 100000;
      newItems2[0].attendees = [newItems2[0].attendees[1] || newItems2[0].attendees[0]];
      newOrderData.items = newItems2;

      const createdOrder = await orderModel.create(newOrderData);
      console.log(`Created split order: ${createdOrder._id}`);

      // Reassign the second ticket to the new order
      await ticketModel.updateOne(
        { _id: chukwuTickets[1]._id },
        { $set: { orderId: createdOrder._id } }
      );
      console.log(`Successfully split Chukwuemeka's order.`);
    }
  } else {
    console.log(`Chukwuemeka's order not found or already split.`);
  }

  // --- 2. Fix Beckyweah's missing ticket and send email ---
  const beckyOrder = await orderModel.findOne({ orderNumber: "CMT-MU786AW1-BVPX" }).populate('eventId');
  if (beckyOrder) {
    const beckyTickets = await ticketModel.find({ orderId: beckyOrder._id });
    if (beckyTickets.length === 0) {
      console.log(`Beckyweah is missing a ticket. Generating ticket and sending email...`);
      
      const crypto = require('crypto');
      const ticketNumber = `GT/T04/EDM`; // Ensure sequence matches
      const qrCodeHash = crypto.randomBytes(16).toString('hex'); // Proper crypto hash

      const newTicket = await ticketModel.create({
        tenantId: beckyOrder.tenantId,
        eventId: (beckyOrder.eventId as any)?._id || beckyOrder.eventId,
        orderId: beckyOrder._id,
        tierId: beckyOrder.items[0].tierId,
        ticketNumber: ticketNumber,
        attendeeName: beckyOrder.customerName,
        attendeeEmail: beckyOrder.customerEmail,
        status: "ISSUED",
        qrCodeHash: qrCodeHash,
        paymentStatus: "PAID",
      });
      console.log(`Created ticket ${ticketNumber} for Beckyweah.`);

      // Send the email using proper ResendService logic
      const event: any = beckyOrder.eventId; 
      try {
        await resendService.sendTicketEmail({
          toEmail: beckyOrder.customerEmail,
          customerName: beckyOrder.customerName,
          eventName: event.name || 'Event',
          eventDate: event.startDate ? new Date(event.startDate).toDateString() : 'TBD',
          eventLocation: event.location || 'TBD',
          ticketNumber: newTicket.ticketNumber,
          tierName: beckyOrder.items[0].tierName,
          qrCodeHash: newTicket.qrCodeHash,
          qrCodeDelivery: event.qrCodeDelivery || 'EMAIL'
        });
        console.log(`Successfully sent ticket email with QR code to Beckyweah (${beckyOrder.customerEmail}).`);
      } catch (err) {
        console.error(`Failed to send email to Beckyweah:`, err.message);
      }
    } else {
      console.log(`Beckyweah already has ticket(s).`);
    }
  } else {
    console.log(`Beckyweah's order not found.`);
  }

  console.log("Data sync and email dispatch complete!");
  await app.close();
  process.exit(0);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
