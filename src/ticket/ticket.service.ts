import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Ticket, TicketDocument, TicketStatus } from '../schemas/ticket.schema';
import { Event, EventDocument } from '../schemas/event.schema';
import { RedisService } from '../redis/redis.service';
import { TicketGeneratorService } from '../ticket-generator/ticket-generator.service';
import { ResendService } from '../resend/resend.service';

@Injectable()
export class TicketService {
  constructor(
    @InjectModel(Ticket.name) private ticketModel: Model<TicketDocument>,
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
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

    return ticket;
  }
}
