import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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

  const missingTickets = [
    {
      orderId: '6a8985b1e2b70b2b137b3f81', // Kennytommy
      attendeeIndex: 1,
    },
    {
      orderId: '6a89868ee2b70b2b137b3f99', // Ayeni
      attendeeIndex: 1,
    }
  ];

  for (const item of missingTickets) {
    const order = await orderModel.findById(item.orderId);
    if (!order) continue;

    const tenant = await tenantModel.findById(order.tenantId);
    const event = await eventModel.findById(order.eventId);
    const orderItem = order.items[0]; // Assuming only one item
    if (!orderItem || !orderItem.attendees) continue;
    
    const attendeeInfo = orderItem.attendees[item.attendeeIndex];
    if (!attendeeInfo) continue;

    const tierDoc = await ticketTierModel.findById(orderItem.tierId);
    
    // Increment sold count manually
    const updatedTierDoc = await ticketTierModel.findByIdAndUpdate(
      orderItem.tierId,
      { $inc: { soldCount: 1 } },
      { new: true },
    );
    
    if (!updatedTierDoc) continue;

    const ticketIndex = updatedTierDoc.soldCount;
    const attendeeDepartment = attendeeInfo.departmentCode || order.departmentCode;

    const formattedTicketCode = generateStructuredTicketCode(
      orderItem.tierName,
      ticketIndex,
      attendeeDepartment,
      tenant ? tenant.slug : 'EDM',
    );

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
      attendeeName: attendeeInfo.name,
      attendeeEmail: attendeeInfo.email,
      qrCodeHash,
      status: TicketStatus.ISSUED,
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
          attendeeName: attendeeInfo.name,
          ticketNumber: formattedTicketCode,
          qrCodeHash: qrCodeUrl,
        });
        
        ticketPdfBuffer = await ticketGeneratorService.generateTicketPdf({
          ticketImageBuffer,
          attendeeName: attendeeInfo.name,
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
        customerName: attendeeInfo.name,
        ticketNumber: ticket.ticketNumber,
        eventName: event ? event.title : 'Event',
        eventDate: event ? new Date(event.startDate).toLocaleString() : '',
        eventLocation: typeof event?.location === 'string' ? event.location : (event?.location as any)?.address || '',
        qrCodeHash: qrCodeUrl,
        tierName: orderItem.tierName,
        ticketPdfBuffer,
        ticketImageBuffer,
      });
      console.log(`Sent email to ${attendeeInfo.email}`);
    } catch (err) {
      console.error('Error sending email:', err);
    }
  }
  
  console.log("Done");
  await app.close();
}

bootstrap();
