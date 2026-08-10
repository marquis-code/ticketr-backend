import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Ticket, TicketDocument, TicketStatus } from '../schemas/ticket.schema';
import { Event, EventDocument } from '../schemas/event.schema';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class TicketService {
  constructor(
    @InjectModel(Ticket.name) private ticketModel: Model<TicketDocument>,
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    private redisService: RedisService,
  ) {}

  async verifyScan(qrCodeHash: string, scannedByUserId: string) {
    // Check Redis scan cache first for instant validation
    const cachedScan = await this.redisService.getCachedTicketScan(qrCodeHash);
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

    const ticket = await this.ticketModel.findOne({ qrCodeHash }).populate('eventId').populate('tierId').exec();
    if (!ticket) {
      throw new NotFoundException('Invalid ticket QR code');
    }

    if (ticket.status === TicketStatus.CANCELLED) {
      throw new BadRequestException('This ticket has been cancelled');
    }

    if (ticket.status === TicketStatus.CHECKED_IN) {
      await this.redisService.cacheTicketScan(qrCodeHash, ticket.toObject());
      return {
        valid: false,
        alreadyCheckedIn: true,
        checkedInAt: ticket.checkedInAt,
        ticketNumber: ticket.ticketNumber,
        attendeeName: ticket.attendeeName,
        message: `⚠️ Ticket already scanned at ${ticket.checkedInAt ? new Date(ticket.checkedInAt).toLocaleTimeString() : ''}`,
      };
    }

    // Mark as checked in
    ticket.status = TicketStatus.CHECKED_IN;
    ticket.checkedInAt = new Date();
    ticket.checkedInBy = scannedByUserId;
    await ticket.save();

    // Cache ticket scan state in Redis
    await this.redisService.cacheTicketScan(qrCodeHash, ticket.toObject());

    return {
      valid: true,
      alreadyCheckedIn: false,
      ticketNumber: ticket.ticketNumber,
      attendeeName: ticket.attendeeName,
      tierName: (ticket.tierId as any)?.name || 'Standard Tier',
      eventName: (ticket.eventId as any)?.title || 'Event',
      checkedInAt: ticket.checkedInAt,
      message: '✅ Ticket check-in successful!',
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
}
