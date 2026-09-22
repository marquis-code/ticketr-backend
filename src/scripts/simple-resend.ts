import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Ticket } from '../schemas/ticket.schema';
import { Order } from '../schemas/order.schema';
import { Event } from '../schemas/event.schema';
import { Tenant } from '../schemas/tenant.schema';
import { TicketTier } from '../schemas/ticket-tier.schema';
import { TicketGeneratorService } from '../ticket-generator/ticket-generator.service';
import { Resend } from 'resend';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const ticketModel = app.get<Model<Ticket>>(getModelToken(Ticket.name));
  const orderModel = app.get<Model<Order>>(getModelToken(Order.name));
  const eventModel = app.get<Model<Event>>(getModelToken(Event.name));
  const tenantModel = app.get<Model<Tenant>>(getModelToken(Tenant.name));
  const tierModel = app.get<Model<TicketTier>>(getModelToken(TicketTier.name));
  const ticketGeneratorService = app.get(TicketGeneratorService);
  const configService = app.get(ConfigService);

  const resend = new Resend(configService.get('RESEND_API_KEY'));
  const fromEmail = configService.get('RESEND_FROM_EMAIL') || 'Ticketr <tickets@ticketr.org>';

  const ticketNumbers = ['GT/T17/EDM'];
  
  for (const tNum of ticketNumbers) {
    const ticket = await ticketModel.findOne({ ticketNumber: tNum });
    if (!ticket) {
      console.log(`Ticket ${tNum} not found`);
      continue;
    }
    const order = await orderModel.findById(ticket.orderId);
    const event = await eventModel.findById(ticket.eventId);
    const tenant = await tenantModel.findById(ticket.tenantId);
    const tier = await tierModel.findById(ticket.tierId);
    
    console.log(`[${tNum}] Generating PDF and resending email...`);
    try {
      const adminDomain = tenant && tenant.slug ? `admin-${tenant.slug}.ticketr.org` : 'admin.ticketr.org';
      const qrCodeUrl = `https://${adminDomain}/verify/${ticket.qrCodeHash}`;
      
      const ticketImageBuffer = await ticketGeneratorService.generateTicketImage({
          templateImageUrl: tier && (tier as any).designUrl ? (tier as any).designUrl : (event && event.bannerUrl ? event.bannerUrl : ''),
          attendeeName: ticket.attendeeName || 'Attendee',
          ticketNumber: ticket.ticketNumber,
          qrCodeHash: qrCodeUrl,
          departmentCode: ticket.departmentCode || 'EDM',
      });
        
      const ticketPdfBuffer = await ticketGeneratorService.generateTicketPdf({
          ticketImageBuffer,
          attendeeName: ticket.attendeeName || 'Attendee',
          eventName: event ? event.title : 'Event Ticket',
          eventDate: event ? new Date(event.startDate).toLocaleString() : '',
          eventLocation: typeof event?.location === 'string' ? event.location : (event?.location as any)?.address || '',
          ticketNumber: ticket.ticketNumber,
          tierName: tier ? tier.name : 'Ticket',
      });

      console.log(`[${tNum}] Sending via Resend SDK directly...`);
      const res = await resend.emails.send({
        from: fromEmail,
        to: ticket.attendeeEmail || 'unknown@example.com',
        subject: `🎟️ Your Ticket for ${event ? event.title : 'Event'} - ${ticket.ticketNumber}`,
        html: `<p>Hi ${ticket.attendeeName || 'Attendee'},</p><p>Please find attached your ticket for ${event ? event.title : 'Event'}.</p>`,
        attachments: [
          {
            filename: `Ticket-${ticket.ticketNumber.replace(/\//g, '-')}.pdf`,
            content: ticketPdfBuffer.toString('base64'),
          }
        ]
      });

      console.log(`[${tNum}] Resend response:`, res);
      if (!res.error) {
          ticket.set('emailDeliveryStatus', 'DELIVERED');
          await ticket.save();
          console.log(`[${tNum}] Successfully sent and status updated`);
      }
    } catch (e) {
      console.error(`[${tNum}] Failed to send email`, e);
    }
  }

  await app.close();
}

bootstrap();
