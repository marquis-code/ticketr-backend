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
  
  const orderModel = app.get<Model<Order>>(getModelToken(Order.name));
  const ticketModel = app.get<Model<Ticket>>(getModelToken(Ticket.name));
  const ticketTierModel = app.get<Model<TicketTier>>(getModelToken(TicketTier.name));
  const tenantModel = app.get<Model<Tenant>>(getModelToken(Tenant.name));
  const eventModel = app.get<Model<Event>>(getModelToken(Event.name));
  const ticketGeneratorService = app.get(TicketGeneratorService);
  const emailService = app.get(ResendService);

  const orderId = '6ab2cfdf04123e19c8ede6a8'; // oyinkansola olanrewaju 
  const order = await orderModel.findById(orderId);
  if (!order) {
    console.log("Order not found");
    await app.close();
    return;
  }

  const tenant = await tenantModel.findById(order.tenantId);
  const event = await eventModel.findById(order.eventId);
  
  for (const orderItem of order.items) {
    console.log(`Processing ${orderItem.tierName}`);
    const attendeeInfo = (orderItem.attendees && orderItem.attendees.length > 0) 
      ? orderItem.attendees[0] 
      : { name: order.customerName, email: order.customerEmail, departmentCode: order.departmentCode };

    const tierDoc = await ticketTierModel.findById(orderItem.tierId);
    if (!tierDoc) {
      console.log(`Tier doc not found for ${orderItem.tierName}`);
      continue;
    }

    let ticketIndex = tierDoc.soldCount + 1;
    let formattedTicketCode;
    let isUnique = false;
    const attendeeDepartment = attendeeInfo.departmentCode || order.departmentCode;

    while (!isUnique) {
      formattedTicketCode = generateStructuredTicketCode(
        orderItem.tierName,
        ticketIndex,
        attendeeDepartment,
        tenant ? tenant.slug : 'EDM',
      );
      const existingTicket = await ticketModel.findOne({ ticketNumber: formattedTicketCode });
      if (existingTicket) {
        ticketIndex++;
      } else {
        isUnique = true;
      }
    }

    await ticketTierModel.findByIdAndUpdate(orderItem.tierId, { soldCount: ticketIndex });

    const qrCodeHash = crypto
      .createHash('sha256')
      .update(`${order._id}-${formattedTicketCode}-${Date.now()}-${Math.random()}`)
      .digest('hex');

    const ticket = await ticketModel.create({
      tenantId: order.tenantId,
      eventId: order.eventId,
      orderId: order._id.toString(),
      tierId: orderItem.tierId,
      ticketNumber: formattedTicketCode,
      departmentCode: attendeeDepartment,
      attendeeName: attendeeInfo.name || 'Attendee',
      attendeeEmail: attendeeInfo.email,
      qrCodeHash,
      status: TicketStatus.ISSUED,
      emailDeliveryStatus: 'DELIVERED'
    });

    console.log(`Created ticket: ${ticket.ticketNumber} for ${attendeeInfo.name}`);

    const adminDomain = tenant && tenant.slug ? `admin-${tenant.slug}.ticketr.org` : 'admin.ticketr.org';
    const qrCodeUrl = `https://${adminDomain}/verify/${qrCodeHash}`;

    let ticketImageBuffer: Buffer | undefined;
    let ticketPdfBuffer: Buffer | undefined;
    let customImageUrl = tierDoc?.templateImageUrl || '';

    if (customImageUrl) {
      try {
        ticketImageBuffer = await ticketGeneratorService.generateTicketImage({
          templateImageUrl: customImageUrl,
          attendeeName: attendeeInfo.name || 'Attendee',
          ticketNumber: formattedTicketCode,
          qrCodeHash: qrCodeUrl,
        });
        
        ticketPdfBuffer = await ticketGeneratorService.generateTicketPdf({
          ticketImageBuffer,
          attendeeName: attendeeInfo.name || 'Attendee',
          eventName: event ? event.title : 'Event Ticket',
          eventDate: event ? new Date(event.startDate).toLocaleString() : '',
          eventLocation: typeof event?.location === 'string' ? event.location : (event?.location as any)?.address || '',
          ticketNumber: formattedTicketCode,
          tierName: orderItem.tierName,
        });
      } catch (err) {
        console.error('Error generating ticket files:', err);
      }
    }

    try {
      await emailService.sendTicketEmail({
        toEmail: attendeeInfo.email,
        customerName: attendeeInfo.name || 'Attendee',
        ticketNumber: ticket.ticketNumber,
        eventName: event ? event.title : 'Event',
        eventDate: event ? new Date(event.startDate).toLocaleString() : '',
        eventLocation: typeof event?.location === 'string' ? event.location : (event?.location as any)?.address || '',
        qrCodeHash: qrCodeUrl,
        tierName: orderItem.tierName,
        ticketPdfBuffer,
        ticketImageBuffer,
        ticketImageUrl: customImageUrl
      });
      console.log(`Sent email to ${attendeeInfo.email}`);
    } catch (err) {
      console.error('Error sending email:', err);
      ticket.set('emailDeliveryStatus', 'FAILED');
      await ticket.save();
    }
  }
  
  console.log("Done");
  await app.close();
}

bootstrap();
