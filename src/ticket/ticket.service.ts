import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Ticket, TicketDocument, TicketStatus } from '../schemas/ticket.schema';
import { Event, EventDocument } from '../schemas/event.schema';
import { TicketTier, TicketTierDocument } from '../schemas/ticket-tier.schema';
import { Order, OrderDocument, OrderStatus } from '../schemas/order.schema';
import { RedisService } from '../redis/redis.service';
import { TicketGeneratorService } from '../ticket-generator/ticket-generator.service';
import { ResendService } from '../resend/resend.service';

@Injectable()
export class TicketService {
  constructor(
    @InjectModel(Ticket.name) private ticketModel: Model<TicketDocument>,
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    @InjectModel(TicketTier.name) private ticketTierModel: Model<TicketTierDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    private redisService: RedisService,
    private ticketGeneratorService: TicketGeneratorService,
    private resendService: ResendService,
  ) {}

  async verifyScan(inputToken: string, scannedByUserId: string, commit: boolean = true) {
    let token = inputToken.trim();
    // Extract hash if the input is a full verification URL
    if (token.includes('/verify/')) {
      token = token.split('/verify/').pop() || token;
    }

    // Check Redis scan cache first for instant validation
    const cachedScan = await this.redisService.getCachedTicketScan(token);
    if (cachedScan && cachedScan.status === TicketStatus.CHECKED_IN) {
      return {
        valid: false,
        alreadyCheckedIn: true,
        checkedInAt: cachedScan.checkedInAt,
        ticketNumber: cachedScan.ticketNumber,
        attendeeName: cachedScan.attendeeName,
        message: `⚠️ Ticket already scanned at ${cachedScan.checkedInAt ? new Date(cachedScan.checkedInAt).toLocaleTimeString() : ''}`,
      };
    }

    // Lookup by either exact QR Code Hash or Case-Insensitive Ticket Number
    const ticket = await this.ticketModel.findOne({
      $or: [
        { qrCodeHash: token },
        { ticketNumber: new RegExp('^' + token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }
      ]
    }).populate('eventId').populate('tierId').exec();

    if (!ticket) {
      throw new NotFoundException('Invalid ticket QR code or ticket number');
    }

    const event = ticket.eventId as any;
    if (event) {
      const now = new Date();
      if (event.startDate && now < new Date(event.startDate)) {
        return {
          valid: false,
          alreadyCheckedIn: false,
          notStarted: true,
          eventTitle: event.title,
          message: `🚫 Event hasn't started yet!`,
        };
      }
      if (event.checkInStart && now < new Date(event.checkInStart)) {
        return {
          valid: false,
          alreadyCheckedIn: false,
          message: `🚫 Check-in for this event has not started yet. Starts at ${new Date(event.checkInStart).toLocaleString()}`,
        };
      }
      if (event.checkInEnd && now > new Date(event.checkInEnd)) {
        return {
          valid: false,
          alreadyCheckedIn: false,
          message: `🚫 Check-in for this event has ended. Ended at ${new Date(event.checkInEnd).toLocaleString()}`,
        };
      }
    }

    if (ticket.status === TicketStatus.CANCELLED) {
      throw new BadRequestException('This ticket has been cancelled');
    }

    if (ticket.status === TicketStatus.CHECKED_IN) {
      await this.redisService.cacheTicketScan(ticket.qrCodeHash, ticket.toObject());
      await this.redisService.cacheTicketScan(ticket.ticketNumber, ticket.toObject());
      return {
        valid: false,
        alreadyCheckedIn: true,
        checkedInAt: ticket.checkedInAt,
        ticketNumber: ticket.ticketNumber,
        attendeeName: ticket.attendeeName,
        message: `⚠️ Ticket already scanned at ${ticket.checkedInAt ? new Date(ticket.checkedInAt).toLocaleTimeString() : ''}`,
      };
    }

    if (commit) {
      // Mark as checked in
      ticket.status = TicketStatus.CHECKED_IN;
      ticket.checkedInAt = new Date();
      ticket.checkedInBy = scannedByUserId;
      await ticket.save();

      // Cache ticket scan state in Redis under both keys for instant subsequent checks
      await this.redisService.cacheTicketScan(ticket.qrCodeHash, ticket.toObject());
      await this.redisService.cacheTicketScan(ticket.ticketNumber, ticket.toObject());
    }

    return {
      valid: true,
      alreadyCheckedIn: false,
      ticketNumber: ticket.ticketNumber,
      attendeeName: ticket.attendeeName,
      tierName: (ticket.tierId as any)?.name || 'Standard Tier',
      eventName: (ticket.eventId as any)?.title || 'Event',
      checkedInAt: ticket.checkedInAt,
      message: commit ? '✅ Ticket check-in successful!' : 'Ticket is valid and ready to be checked in.',
    };
  }

  async getTicketsForEvent(eventId: string) {
    return this.ticketModel.find({ eventId }).populate('tierId').sort({ createdAt: -1 }).exec();
  }

  async getTicketByNumber(ticketNumber: string) {
    const ticket = await this.ticketModel.findOne({ ticketNumber }).populate('eventId').populate('tierId').exec();
    if (!ticket) {
      throw new NotFoundException(`Ticket '${ticketNumber}' not found`);
    }
    return ticket;
  }

  async downloadTicketPdf(ticketId: string): Promise<Buffer> {
    const ticket = await this.ticketModel.findById(ticketId).populate('eventId').populate('tierId').populate('tenantId').exec();
    if (!ticket) throw new NotFoundException('Ticket not found');
    
    const tier = ticket.tierId as any;
    const event = ticket.eventId as any;
    const tenant = ticket.tenantId as any;
    
    if (!tier || !tier.templateImageUrl) {
      throw new BadRequestException('This ticket tier does not support custom PDF generation');
    }

    const adminDomain = tenant && tenant.slug ? `admin-${tenant.slug}.ticketr.org` : 'admin.ticketr.org';
    // Pass the full URL to the QR code generator so it's scannable
    const qrCodeUrl = `https://${adminDomain}/verify/${ticket.qrCodeHash}`;

    const ticketImageBuffer = await this.ticketGeneratorService.generateTicketImage({
      templateImageUrl: tier.templateImageUrl,
      attendeeName: ticket.attendeeName || 'Guest',
      ticketNumber: ticket.ticketNumber,
      qrCodeHash: qrCodeUrl,
    });

    return this.ticketGeneratorService.generateTicketPdf({
      ticketImageBuffer,
      attendeeName: ticket.attendeeName || 'Guest',
      eventName: event.title || 'Event Ticket',
      eventDate: event.startDate ? new Date(event.startDate).toLocaleString() : '',
      eventLocation: event.location || '',
      ticketNumber: ticket.ticketNumber,
      tierName: tier.name || 'Standard',
    });
  }

  async claimGroupTicket(ticketId: string, attendeeName: string, attendeeEmail: string, claimedById: string) {
    const ticket = await this.ticketModel.findById(ticketId);
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
    if (!ticket.isGroupTicket) {
      throw new BadRequestException('This is not a group ticket');
    }
    if (ticket.claimedAt) {
      throw new BadRequestException('This ticket has already been claimed');
    }

    ticket.attendeeName = attendeeName;
    ticket.attendeeEmail = attendeeEmail;
    ticket.claimedById = claimedById;
    ticket.claimedAt = new Date();

    return ticket.save();
  }

  async transferTicket(ticketId: string, currentOwnerId: string, newAttendeeName: string, newAttendeeEmail: string, newOwnerId?: string) {
    const ticket = await this.ticketModel.findById(ticketId);
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
    
    // In a real app, verify that the requester is the current owner or admin
    if (ticket.status !== TicketStatus.ISSUED) {
      throw new BadRequestException('Only issued (unused) tickets can be transferred');
    }
    if (!ticket.isResaleable) {
      throw new BadRequestException('This ticket is not allowed to be transferred');
    }

    // Invalidate the old QR code by regenerating the hash
    const newQrCodeHash = crypto
      .createHash('sha256')
      .update(`${ticket.orderId}-${ticket.ticketNumber}-${Date.now()}-${Math.random()}-TRANSFERRED`)
      .digest('hex');

    ticket.qrCodeHash = newQrCodeHash;
    ticket.attendeeName = newAttendeeName;
    ticket.attendeeEmail = newAttendeeEmail;
    if (newOwnerId) {
      ticket.currentOwnerId = newOwnerId;
    }

    await ticket.save();
    
    // Return the updated ticket with the new hash so a new PDF/Email can be generated
    return ticket;
  }

  async resendTicketEmail(ticketId: string, newEmail?: string) {
    const ticket = await this.ticketModel.findById(ticketId)
      .populate('eventId')
      .populate('tierId')
      .populate('tenantId')
      .exec();

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (newEmail) {
      ticket.attendeeEmail = newEmail;
      await ticket.save();
    }

    if (!ticket.attendeeEmail) {
      throw new BadRequestException('Ticket has no attendee email address assigned');
    }

    const tier = ticket.tierId as any;
    const event = ticket.eventId as any;
    const tenant = ticket.tenantId as any;
    
    const adminDomain = tenant && tenant.slug ? `admin-${tenant.slug}.ticketr.org` : 'admin.ticketr.org';
    const qrCodeUrl = `https://${adminDomain}/verify/${ticket.qrCodeHash}`;
    let customImageUrl = tier?.templateImageUrl || '';
    
    let ticketImageBuffer: Buffer | undefined;
    let ticketPdfBuffer: Buffer | undefined;

    if (customImageUrl) {
      try {
        ticketImageBuffer = await this.ticketGeneratorService.generateTicketImage({
          templateImageUrl: customImageUrl,
          attendeeName: ticket.attendeeName || 'Guest',
          ticketNumber: ticket.ticketNumber,
          qrCodeHash: qrCodeUrl,
        });
        
        ticketPdfBuffer = await this.ticketGeneratorService.generateTicketPdf({
          ticketImageBuffer,
          attendeeName: ticket.attendeeName || 'Guest',
          eventName: event ? event.title : 'Event Ticket',
          eventDate: event && event.startDate ? new Date(event.startDate).toLocaleString() : '',
          eventLocation: event ? event.location : '',
          ticketNumber: ticket.ticketNumber,
          tierName: tier ? tier.name : 'Standard',
        });
        
        customImageUrl = '';
      } catch (error) {
        console.error(`Failed to generate custom ticket for ${ticket.ticketNumber}`, error);
      }
    }

    try {
      await this.resendService.sendTicketEmail({
        toEmail: ticket.attendeeEmail,
        customerName: ticket.attendeeName || 'Guest',
        eventName: event ? event.title : 'Event Ticket',
        eventDate: event && event.startDate ? new Date(event.startDate).toLocaleString() : '',
        eventLocation: event ? event.location : '',
        ticketNumber: ticket.ticketNumber,
        tierName: tier ? tier.name : 'Standard',
        qrCodeHash: qrCodeUrl,
        ticketImageUrl: customImageUrl,
        ticketImageBuffer,
        ticketPdfBuffer,
      });
      
      ticket.emailSent = true;
      await ticket.save();
    } catch (emailErr) {
      console.error(`Failed to resend ticket email to ${ticket.attendeeEmail}`, emailErr);
      ticket.emailSent = false;
      await ticket.save();
      throw new BadRequestException('Internal server error while attempting to send ticket email');
    }
  }

  async changeTicketTier(ticketId: string, newTierId: string, adminUserId: string) {
    const ticket = await this.ticketModel.findById(ticketId).populate('tenantId').exec();
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status !== TicketStatus.ISSUED) {
      throw new BadRequestException('Only issued tickets can be modified');
    }
    
    if (ticket.tierId.toString() === newTierId) {
      throw new BadRequestException('Ticket is already of this tier');
    }

    const newTier = await this.ticketTierModel.findById(newTierId);
    if (!newTier) throw new NotFoundException('New ticket tier not found');

    const order = await this.orderModel.findById(ticket.orderId);
    if (!order) throw new NotFoundException('Associated order not found');

    const oldTierIdStr = ticket.tierId.toString();

    // Find the item in the order
    const itemIndex = order.items.findIndex(item => item.tierId.toString() === oldTierIdStr);
    if (itemIndex === -1) {
       throw new BadRequestException('Ticket tier not found in order items');
    }

    const oldItem = order.items[itemIndex];
    const oldPrice = oldItem.unitPrice;
    const newPrice = newTier.price;
    const priceDiff = newPrice - oldPrice;

    // Update old item
    if (oldItem.quantity === 1) {
      // Remove entirely, we will add new or merge
      order.items.splice(itemIndex, 1);
    } else {
      oldItem.quantity -= 1;
      oldItem.subtotal -= oldPrice;
      if (oldItem.attendees && oldItem.attendees.length > 0) {
        const attIndex = oldItem.attendees.findIndex(a => a.email === ticket.attendeeEmail && a.name === ticket.attendeeName);
        if (attIndex !== -1) {
          oldItem.attendees.splice(attIndex, 1);
        } else {
           oldItem.attendees.pop(); // just pop one
        }
      }
    }

    // Add or update new item in order
    const newItemIndex = order.items.findIndex(item => item.tierId.toString() === newTierId);
    if (newItemIndex !== -1) {
      order.items[newItemIndex].quantity += 1;
      order.items[newItemIndex].subtotal += newPrice;
      if (order.items[newItemIndex].attendees) {
        order.items[newItemIndex].attendees.push({
          name: ticket.attendeeName || order.customerName,
          email: ticket.attendeeEmail || order.customerEmail,
          departmentCode: ticket.departmentCode
        });
      }
    } else {
      order.items.push({
        tierId: newTierId,
        tierName: newTier.name,
        unitPrice: newPrice,
        quantity: 1,
        subtotal: newPrice,
        attendees: [{
          name: ticket.attendeeName || order.customerName,
          email: ticket.attendeeEmail || order.customerEmail,
          departmentCode: ticket.departmentCode
        }]
      });
    }

    // Update total amount
    order.totalAmount += priceDiff;
    if (order.amountRemaining !== undefined && order.amountPaid !== undefined) {
      order.amountRemaining = order.totalAmount - order.amountPaid;
      if (order.amountRemaining > 0) {
        order.status = OrderStatus.PARTIALLY_PAID;
      }
      if (order.amountRemaining <= 0) {
        order.status = OrderStatus.PAID;
        order.amountRemaining = 0; 
      }
    }

    order.updatedBy = adminUserId;
    await order.save();

    function generateStructuredTicketCode(
      tierName: string,
      ticketIndex: number,
      departmentCode?: string,
      tenantSlug?: string,
    ): string {
      let tierPrefix = 'R';
      const name = tierName.toUpperCase();
      if (name.includes('VVIP') || name.includes('VERY VIP')) tierPrefix = 'VV';
      else if (name.includes('VIP')) tierPrefix = 'V';
      else if (name.includes('REGULAR') || name.includes('STANDARD')) tierPrefix = 'R';
      else if (name.includes('STUDENT')) tierPrefix = 'S';
      else tierPrefix = tierName.split(' ').map((w) => w[0]).join('').toUpperCase().substring(0, 3) || 'R';
      
      const formattedIndex = ticketIndex < 10 ? `0${ticketIndex}` : `${ticketIndex}`;
      const rawDept = departmentCode || tenantSlug || 'EDM';
      const deptCode = rawDept.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'EDM';
      return `${tierPrefix}/T${formattedIndex}/${deptCode}`;
    }

    let ticketIndex = 1;
    const match = ticket.ticketNumber.match(/\/T(\d+)\//);
    if (match) {
      ticketIndex = parseInt(match[1], 10);
    }

    const tenant = ticket.tenantId as any;
    const newTicketNumber = generateStructuredTicketCode(
      newTier.name,
      ticketIndex,
      ticket.departmentCode,
      tenant ? tenant.slug : 'EDM'
    );

    const newQrCodeHash = crypto
      .createHash('sha256')
      .update(`${order._id}-${newTicketNumber}-${Date.now()}-${Math.random()}-TIER_CHANGED`)
      .digest('hex');

    ticket.tierId = newTierId;
    ticket.ticketNumber = newTicketNumber;
    ticket.qrCodeHash = newQrCodeHash;
    
    await ticket.save();

    // Resend email with new ticket
    try {
      await this.resendTicketEmail(ticket._id.toString());
    } catch (e) {
      console.error('Failed to send updated ticket email', e);
    }

    return {
      success: true,
      ticket,
      orderStatus: order.status,
      priceDifference: priceDiff
    };
  }
}
