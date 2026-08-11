import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Ticket, TicketDocument, TicketStatus } from '../schemas/ticket.schema';
import { Event, EventDocument } from '../schemas/event.schema';
import { RedisService } from '../redis/redis.service';
import { TicketGeneratorService } from '../ticket-generator/ticket-generator.service';

@Injectable()
export class TicketService {
  constructor(
    @InjectModel(Ticket.name) private ticketModel: Model<TicketDocument>,
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    private redisService: RedisService,
    private ticketGeneratorService: TicketGeneratorService,
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
      attendeeName: ticket.attendeeName,
      ticketNumber: ticket.ticketNumber,
      qrCodeHash: qrCodeUrl,
    });

    return this.ticketGeneratorService.generateTicketPdf({
      ticketImageBuffer,
      attendeeName: ticket.attendeeName,
      eventName: event.title || 'Event Ticket',
      eventDate: event.startDate ? new Date(event.startDate).toLocaleString() : '',
      eventLocation: event.location || '',
      ticketNumber: ticket.ticketNumber,
      tierName: tier.name,
    });
  }
}
