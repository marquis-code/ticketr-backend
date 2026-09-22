import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Ticket } from '../schemas/ticket.schema';
import { Order } from '../schemas/order.schema';
import { Event } from '../schemas/event.schema';
import { Tenant } from '../schemas/tenant.schema';
import { TicketTier } from '../schemas/ticket-tier.schema';
import { ResendService } from '../resend/resend.service';
import { TicketGeneratorService } from '../ticket-generator/ticket-generator.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const ticketModel = app.get<Model<Ticket>>(getModelToken(Ticket.name));
  const orderModel = app.get<Model<Order>>(getModelToken(Order.name));
  const eventModel = app.get<Model<Event>>(getModelToken(Event.name));
  const tenantModel = app.get<Model<Tenant>>(getModelToken(Tenant.name));
  const tierModel = app.get<Model<TicketTier>>(getModelToken(TicketTier.name));
  const resendService = app.get(ResendService);
  const ticketGeneratorService = app.get(TicketGeneratorService);

  const ticketNumbers = ['GT/T17/EDM', 'GT/T18/EDM', 'GT/T19/EDM', 'GT/T20/EDM', 'GT/T21/EDM'];
  
  for (const tNum of ticketNumbers) {
    const ticket = await ticketModel.findOne({ ticketNumber: tNum });
    if (!ticket) {
      console.log(`Ticket ${tNum} not found`);
      continue;
    }
    const order = await orderModel.findById(ticket.orderId);
    if (!order) {
        console.log(`Order for ticket ${tNum} not found`);
        continue;
    }
    const event = await eventModel.findById(ticket.eventId);
    const tenant = await tenantModel.findById(ticket.tenantId);
    const tier = await tierModel.findById(ticket.tierId);
    
    console.log(`Generating PDF and resending email for ${tNum}...`);
    try {
      
      const adminDomain = tenant && tenant.slug ? `admin-${tenant.slug}.ticketr.org` : 'admin.ticketr.org';
      const qrCodeUrl = `https://${adminDomain}/verify/${ticket.qrCodeHash}`;
      let customImageUrl: string | undefined;

      console.log(`[${tNum}] Generating image with URL: ${tier && (tier as any).designUrl ? (tier as any).designUrl : (event && event.bannerUrl ? event.bannerUrl : '')}`);
      const ticketImageBuffer = await ticketGeneratorService.generateTicketImage({
          templateImageUrl: tier && (tier as any).designUrl ? (tier as any).designUrl : (event && event.bannerUrl ? event.bannerUrl : ''),
          attendeeName: ticket.attendeeName || 'Attendee',
          ticketNumber: ticket.ticketNumber,
          qrCodeHash: qrCodeUrl,
          departmentCode: ticket.departmentCode || 'EDM',
      });
      console.log(`[${tNum}] Image generated`);
        
      console.log(`[${tNum}] Generating PDF`);
      const ticketPdfBuffer = await ticketGeneratorService.generateTicketPdf({
          ticketImageBuffer,
          attendeeName: ticket.attendeeName || 'Attendee',
          eventName: event ? event.title : 'Event Ticket',
          eventDate: event ? new Date(event.startDate).toLocaleString() : '',
          eventLocation: typeof event?.location === 'string' ? event.location : (event?.location as any)?.address || '',
          ticketNumber: ticket.ticketNumber,
          tierName: tier ? tier.name : 'Ticket',
      });
      console.log(`[${tNum}] PDF generated, sending email`);

      await resendService.sendTicketEmail({
        toEmail: ticket.attendeeEmail || 'unknown@example.com',
        customerName: ticket.attendeeName || 'Attendee',
        ticketNumber: ticket.ticketNumber,
        eventName: event ? event.title : 'Event',
        eventDate: event ? new Date(event.startDate).toLocaleString() : '',
        eventLocation: typeof event?.location === 'string' ? event.location : (event?.location as any)?.address || '',
        qrCodeHash: qrCodeUrl,
        tierName: tier ? tier.name : 'Ticket',
        ticketPdfBuffer,
        ticketImageBuffer,
        ticketImageUrl: customImageUrl
      });
      
      ticket.set('emailDeliveryStatus', 'DELIVERED');
      await ticket.save();
      console.log(`Successfully sent email for ${tNum}`);
    } catch (e) {
      console.error(`Failed to send email for ${tNum}`, e);
    }
  }

  await app.close();
}

bootstrap();
