import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order } from '../schemas/order.schema';
import { TicketTier } from '../schemas/ticket-tier.schema';
import { Ticket, TicketStatus } from '../schemas/ticket.schema';
import { Tenant } from '../schemas/tenant.schema';
import { Event } from '../schemas/event.schema';
import { TicketGeneratorService } from '../ticket-generator/ticket-generator.service';
import { ResendService } from '../resend/resend.service';
import * as crypto from 'crypto';

function generateStructuredTicketCode(
  tierName: string,
  ticketIndex: number,
  departmentCode?: string,
  tenantSlug?: string,
): string {
  let tierPrefix = 'R';
  const name = tierName.toUpperCase();

  if (name.includes('VVIP') || name.includes('VERY VIP')) {
    tierPrefix = 'VV';
  } else if (name.includes('VIP')) {
    tierPrefix = 'V';
  } else if (name.includes('REGULAR') || name.includes('STANDARD')) {
    tierPrefix = 'R';
  } else if (name.includes('STUDENT')) {
    tierPrefix = 'S';
  } else {
    tierPrefix = tierName
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .substring(0, 3) || 'R';
  }

  const formattedIndex = ticketIndex < 10 ? `0${ticketIndex}` : `${ticketIndex}`;
  const ticketNumberPart = `T${formattedIndex}`;

  const rawDept = departmentCode || tenantSlug || 'EDM';
  const deptCode = rawDept.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'EDM';

  return `${tierPrefix}/${ticketNumberPart}/${deptCode}`;
}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  
  const ticketModel = app.get<Model<Ticket>>(getModelToken(Ticket.name));
  const ticketTierModel = app.get<Model<TicketTier>>(getModelToken(TicketTier.name));
  const tenantModel = app.get<Model<Tenant>>(getModelToken(Tenant.name));
  const eventModel = app.get<Model<Event>>(getModelToken(Event.name));
  const ticketGeneratorService = app.get(TicketGeneratorService);
  const emailService = app.get(ResendService);

  const tickets = await ticketModel.find({ orderId: '6ab247c679fb91dc10d74af1' });
  
  for (const ticket of tickets) {
    console.log(`Processing ticket ${ticket.ticketNumber}`);
    
    // Update the ticket email
    ticket.attendeeEmail = 'Emmanuelmgbogo@gmail.com';
    await ticket.save();

    const tenant = await tenantModel.findById(ticket.tenantId);
    const event = await eventModel.findById(ticket.eventId);
    const tierDoc = await ticketTierModel.findById(ticket.tierId);
    
    const adminDomain = tenant && tenant.slug ? `admin-${tenant.slug}.ticketr.org` : 'admin.ticketr.org';
    const qrCodeUrl = `https://${adminDomain}/verify/${ticket.qrCodeHash}`;

    let ticketImageBuffer: Buffer | undefined;
    let ticketPdfBuffer: Buffer | undefined;
    let customImageUrl = tierDoc?.templateImageUrl || '';

    if (customImageUrl) {
      try {
        ticketImageBuffer = await ticketGeneratorService.generateTicketImage({
          templateImageUrl: customImageUrl,
          attendeeName: ticket.attendeeName || 'Emmanuel',
          ticketNumber: ticket.ticketNumber,
          qrCodeHash: qrCodeUrl,
        });
        
        ticketPdfBuffer = await ticketGeneratorService.generateTicketPdf({
          ticketImageBuffer,
          attendeeName: ticket.attendeeName || 'Emmanuel',
          eventName: event ? event.title : 'Event Ticket',
          eventDate: event ? new Date(event.startDate).toLocaleString() : '',
          eventLocation: typeof event?.location === 'string' ? event.location : (event?.location as any)?.address || '',
          ticketNumber: ticket.ticketNumber,
          tierName: tierDoc?.name || 'Ticket',
        });
      } catch (err) {
        console.error('Error generating ticket files:', err);
      }
    }

    try {
      await emailService.sendTicketEmail({
        toEmail: ticket.attendeeEmail,
        customerName: ticket.attendeeName || 'Emmanuel',
        ticketNumber: ticket.ticketNumber,
        eventName: event ? event.title : 'Event',
        eventDate: event ? new Date(event.startDate).toLocaleString() : '',
        eventLocation: typeof event?.location === 'string' ? event.location : (event?.location as any)?.address || '',
        qrCodeHash: qrCodeUrl,
        tierName: tierDoc?.name || 'Ticket',
        ticketPdfBuffer,
        ticketImageBuffer,
        ticketImageUrl: customImageUrl
      });
      console.log(`Sent email to ${ticket.attendeeEmail}`);
    } catch (err) {
      console.error('Error sending email:', err);
    }
  }
  
  console.log("Done");
  await app.close();
}

bootstrap();
