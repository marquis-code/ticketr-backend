import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Ticket, TicketDocument, TicketStatus } from '../schemas/ticket.schema';
import { Event, EventDocument, EventStatus } from '../schemas/event.schema';
import { TicketTier, TicketTierDocument } from '../schemas/ticket-tier.schema';
import { Order, OrderDocument, OrderStatus } from '../schemas/order.schema';
import {
  ResaleListing,
  ResaleListingDocument,
  ResaleStatus,
} from '../schemas/resale-listing.schema';
import { RedisService } from '../redis/redis.service';
import { TicketGeneratorService } from '../ticket-generator/ticket-generator.service';
import { ResendService } from '../resend/resend.service';
import { Tenant, TenantDocument } from '../schemas/tenant.schema';
import { PaystackService } from '../paystack/paystack.service';

interface ScannerContext {
  userId: string;
  role?: string;
  tenantId?: string;
  eventId?: string;
}

interface AccessContext {
  walletToken?: string;
  userId?: string;
  tenantId?: string;
  role?: string;
}

@Injectable()
export class TicketService {
  constructor(
    @InjectModel(Ticket.name) private ticketModel: Model<TicketDocument>,
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    @InjectModel(TicketTier.name) private ticketTierModel: Model<TicketTierDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(Tenant.name) private tenantModel: Model<TenantDocument>,
    @InjectModel(ResaleListing.name)
    private resaleModel: Model<ResaleListingDocument>,
    private redisService: RedisService,
    private ticketGeneratorService: TicketGeneratorService,
    private resendService: ResendService,
    private paystackService: PaystackService,
  ) {}

  // ---------------------------------------------------------------------------
  // Gate scanning — scoped by tenant/event, atomic first-scan-wins.
  // ---------------------------------------------------------------------------

  async verifyScan(inputToken: string, ctx: ScannerContext, commit: boolean = true) {
    if (!inputToken) throw new BadRequestException('QR code or ticket number is required');

    let token = String(inputToken).trim();
    if (token.includes('/verify/')) {
      token = token.split('/verify/').pop() || token;
    }
    token = token.split('?')[0];

    if (!ctx.tenantId) {
      throw new ForbiddenException('A gate scanner must belong to an organization');
    }

    let event: EventDocument | null = null;
    if (ctx.eventId) {
      event = await this.eventModel.findOne({ _id: ctx.eventId, tenantId: ctx.tenantId });
      if (!event) throw new ForbiddenException('That event does not belong to your organization');
    }

    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const scope: any = { tenantId: ctx.tenantId };
    if (event) scope.eventId = event._id;

    const ticket = await this.ticketModel
      .findOne({
        ...scope,
        $or: [
          { qrCodeHash: token },
          { ticketNumber: new RegExp(`^${escaped}$`, 'i') },
        ],
      })
      .populate('eventId')
      .populate('tierId')
      .exec();

    if (!ticket) {
      throw new NotFoundException(
        'This ticket is not valid for your organization. Check the event and try again.',
      );
    }

    const ticketEvent = (event || ticket.eventId) as any;
    if (ticketEvent) {
      const now = new Date();
      if (ticketEvent.status === EventStatus.CANCELLED) {
        return {
          valid: false,
          alreadyCheckedIn: false,
          eventTitle: ticketEvent.title,
          message: 'This event has been cancelled.',
        };
      }
      if (ticketEvent.checkInStart && now < new Date(ticketEvent.checkInStart)) {
        return {
          valid: false,
          alreadyCheckedIn: false,
          eventTitle: ticketEvent.title,
          message: `Check-in has not started. Opens ${new Date(
            ticketEvent.checkInStart,
          ).toLocaleString()}.`,
        };
      }
      if (ticketEvent.checkInEnd && now > new Date(ticketEvent.checkInEnd)) {
        return {
          valid: false,
          alreadyCheckedIn: false,
          eventTitle: ticketEvent.title,
          message: `Check-in has ended (${new Date(ticketEvent.checkInEnd).toLocaleString()}).`,
        };
      }
      if (!ticketEvent.checkInStart && ticketEvent.startDate && now < new Date(ticketEvent.startDate)) {
        return {
          valid: false,
          alreadyCheckedIn: false,
          eventTitle: ticketEvent.title,
          message: 'This event has not started yet.',
        };
      }
    }

    if (ticket.status === TicketStatus.CANCELLED) {
      throw new BadRequestException('This ticket has been cancelled');
    }

    if (ticket.status === TicketStatus.CHECKED_IN) {
      return this.alreadyCheckedInResponse(ticket);
    }

    if (!commit) {
      return {
        valid: true,
        alreadyCheckedIn: false,
        ticketNumber: ticket.ticketNumber,
        attendeeName: ticket.attendeeName,
        tierName: (ticket.tierId as any)?.name || 'Standard',
        eventName: (ticket.eventId as any)?.title || 'Event',
        message: 'Ticket is valid and ready to be checked in.',
      };
    }

    // Atomic compare-and-set: two scanners racing on the same ticket can never
    // both succeed. The loser is told it was already scanned.
    const now = new Date();
    const updated = await this.ticketModel
      .findOneAndUpdate(
        { _id: ticket._id, status: TicketStatus.ISSUED },
        {
          $set: {
            status: TicketStatus.CHECKED_IN,
            checkedInAt: now,
            checkedInBy: ctx.userId,
          },
          $inc: { scanCount: 1 },
        },
        { new: true },
      )
      .exec();

    if (!updated) {
      const current = await this.ticketModel.findById(ticket._id);
      if (current) return this.alreadyCheckedInResponse(current);
      throw new ConflictException('Could not check this ticket in. Please retry.');
    }

    await this.cacheTicket(updated);

    return {
      valid: true,
      alreadyCheckedIn: false,
      ticketNumber: updated.ticketNumber,
      attendeeName: updated.attendeeName,
      tierName: (ticket.tierId as any)?.name || 'Standard',
      eventName: (ticket.eventId as any)?.title || 'Event',
      checkedInAt: updated.checkedInAt,
      message: 'Ticket checked in successfully.',
    };
  }

  private alreadyCheckedInResponse(ticket: TicketDocument) {
    return {
      valid: false,
      alreadyCheckedIn: true,
      checkedInAt: ticket.checkedInAt,
      ticketNumber: ticket.ticketNumber,
      attendeeName: ticket.attendeeName,
      message: `Already scanned${
        ticket.checkedInAt
          ? ` at ${new Date(ticket.checkedInAt).toLocaleTimeString()}`
          : ''
      }. Do not admit again.`,
    };
  }

  private async cacheTicket(ticket: TicketDocument) {
    try {
      const payload = {
        status: ticket.status,
        checkedInAt: ticket.checkedInAt,
        ticketNumber: ticket.ticketNumber,
        attendeeName: ticket.attendeeName,
        tenantId: ticket.tenantId?.toString(),
      };
      await this.redisService.set(`ticket:scan:${ticket.qrCodeHash}`, payload, 86400);
    } catch {
      /* cache is optional */
    }
  }

  async invalidateScanCache(ticket: TicketDocument) {
    try {
      await this.redisService.del(`ticket:scan:${ticket.qrCodeHash}`);
    } catch {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------------------
  // Organizer reads
  // ---------------------------------------------------------------------------

  async getTicketsForEvent(eventId: string, tenantId: string) {
    const event = await this.eventModel.findOne({ _id: eventId, tenantId });
    if (!event) throw new NotFoundException('Event not found');
    return this.ticketModel
      .find({ eventId, tenantId })
      .populate('tierId')
      .sort({ createdAt: -1 })
      .exec();
  }

  async getTicketByNumber(ticketNumber: string, tenantId: string) {
    const ticket = await this.ticketModel
      .findOne({ tenantId, ticketNumber: new RegExp(`^${ticketNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })
      .populate('eventId')
      .populate('tierId')
      .exec();
    if (!ticket) throw new NotFoundException(`Ticket '${ticketNumber}' not found`);
    return ticket;
  }

  // ---------------------------------------------------------------------------
  // Ticket documents
  // ---------------------------------------------------------------------------

  private async assertTicketAccess(ticket: TicketDocument, ctx: AccessContext) {
    if (ctx.role === 'SUPER_ADMIN') return;

    if (ctx.tenantId) {
      const event = await this.eventModel.findById(ticket.eventId);
      if (event && event.tenantId.toString() === ctx.tenantId.toString()) return;
    }

    if (ctx.walletToken) {
      const order = await this.orderModel.findById(ticket.orderId);
      if (order && order.walletToken === ctx.walletToken) return;
    }

    if (ctx.userId) {
      const order = await this.orderModel.findById(ticket.orderId);
      if (
        order &&
        (order.customerEmail === (ctx as any).email || ticket.attendeeEmail === (ctx as any).email)
      ) {
        return;
      }
    }

    throw new ForbiddenException('You do not have access to this ticket');
  }

  async downloadTicketPdf(ticketId: string, ctx: AccessContext): Promise<Buffer> {
    const ticket = await this.ticketModel
      .findById(ticketId)
      .populate('eventId')
      .populate('tierId')
      .populate('tenantId')
      .exec();
    if (!ticket) throw new NotFoundException('Ticket not found');
    await this.assertTicketAccess(ticket, ctx);

    const tier = ticket.tierId as any;
    const event = ticket.eventId as any;
    const tenant = ticket.tenantId as any;

    if (!tier || !tier.templateImageUrl) {
      throw new BadRequestException(
        'This ticket tier does not use a custom PDF template. Use the wallet QR code instead.',
      );
    }

    const adminDomain =
      tenant && tenant.slug ? `admin-${tenant.slug}.ticketr.org` : 'admin.ticketr.org';
    const qrCodeUrl = `https://${adminDomain}/admin/verify/${ticket.qrCodeHash}`;

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

  // ---------------------------------------------------------------------------
  // Transfer / claim
  // ---------------------------------------------------------------------------

  async transferTicket(
    ticketId: string,
    ctx: AccessContext,
    newAttendeeName: string,
    newAttendeeEmail: string,
  ) {
    const ticket = await this.ticketModel.findById(ticketId);
    if (!ticket) throw new NotFoundException('Ticket not found');
    await this.assertTicketAccess(ticket, ctx);

    const event = await this.eventModel.findById(ticket.eventId);
    if (!event) throw new NotFoundException('Event not found');
    if (!event.resaleEnabled) {
      throw new ForbiddenException('Transfers are disabled for this event');
    }
    if (!ticket.isResaleable) {
      throw new BadRequestException('This ticket cannot be transferred');
    }
    if (ticket.status !== TicketStatus.ISSUED) {
      throw new BadRequestException('Only unused tickets can be transferred');
    }
    if (new Date(event.startDate).getTime() < Date.now() + 60 * 60 * 1000) {
      throw new BadRequestException('Transfers close one hour before the event starts');
    }
    if (!newAttendeeName?.trim() || !newAttendeeEmail?.includes('@')) {
      throw new BadRequestException('A valid attendee name and email are required');
    }
    if (
      (ticket.attendeeEmail || '').toLowerCase() === newAttendeeEmail.toLowerCase().trim()
    ) {
      throw new BadRequestException('This ticket already belongs to that attendee');
    }

    const previousHash = ticket.qrCodeHash;
    const newQrCodeHash = crypto
      .createHash('sha256')
      .update(`${ticket.orderId}-${ticket.ticketNumber}-${Date.now()}-${Math.random()}-TRANSFERRED`)
      .digest('hex');

    ticket.qrCodeHash = newQrCodeHash;
    ticket.attendeeName = newAttendeeName.trim();
    ticket.attendeeEmail = newAttendeeEmail.toLowerCase().trim();
    ticket.transferCount = (ticket.transferCount || 0) + 1;
    ticket.lastTransferredAt = new Date();
    ticket.emailSent = false;
    await ticket.save();

    try {
      await this.redisService.del(`ticket:scan:${previousHash}`);
    } catch {
      /* ignore */
    }

    const order = await this.orderModel.findById(ticket.orderId);
    const tenant = order ? await this.tenantModel.findById(order.tenantId) : null;
    const walletUrl = order
      ? `${(process.env.FRONTEND_URL || 'https://ticketr.org').replace(/\/+$/, '')}/my-tickets?token=${order.walletToken}`
      : '';

    await this.sendTicketEmail(ticket, event, tenant, walletUrl);

    return {
      success: true,
      ticketNumber: ticket.ticketNumber,
      attendeeName: ticket.attendeeName,
      attendeeEmail: ticket.attendeeEmail,
      transferCount: ticket.transferCount,
      message:
        'Ticket transferred. The previous QR code is now void and the new attendee has been emailed a fresh pass.',
    };
  }

  async claimGroupTicket(
    ticketId: string,
    ctx: AccessContext,
    attendeeName: string,
    attendeeEmail: string,
  ) {
    const ticket = await this.ticketModel.findById(ticketId);
    if (!ticket) throw new NotFoundException('Ticket not found');
    await this.assertTicketAccess(ticket, ctx);

    if (!ticket.isGroupTicket && !ticket.claimedAt) {
      // Non-group tickets can still be personalised by their owner once.
    }
    if (ticket.claimedAt) {
      throw new BadRequestException('This ticket has already been claimed');
    }
    if (!attendeeName?.trim() || !attendeeEmail?.includes('@')) {
      throw new BadRequestException('A valid attendee name and email are required');
    }

    ticket.attendeeName = attendeeName.trim();
    ticket.attendeeEmail = attendeeEmail.toLowerCase().trim();
    ticket.claimedById = ctx.userId;
    ticket.claimedAt = new Date();
    await ticket.save();
    return ticket;
  }

  // ---------------------------------------------------------------------------
  // Email delivery
  // ---------------------------------------------------------------------------

  private async sendTicketEmail(
    ticket: TicketDocument,
    event: EventDocument,
    tenant: TenantDocument | null,
    walletUrl: string,
  ) {
    if (!ticket.attendeeEmail) return;
    const tier = await this.ticketTierModel.findById(ticket.tierId);
    const adminDomain =
      tenant && tenant.slug ? `admin-${tenant.slug}.ticketr.org` : 'admin.ticketr.org';
    const qrCodeUrl = `https://${adminDomain}/admin/verify/${ticket.qrCodeHash}`;
    const qrCodeDelivery = (event as any).qrCodeDelivery || 'STAMP_ON_TICKET';

    let ticketImageBuffer: Buffer | undefined;
    let ticketPdfBuffer: Buffer | undefined;
    let customImageUrl = tier?.templateImageUrl || '';

    if (customImageUrl && qrCodeDelivery === 'STAMP_ON_TICKET') {
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
          eventName: event.title,
          eventDate: new Date(event.startDate).toLocaleString(),
          eventLocation: event.location,
          ticketNumber: ticket.ticketNumber,
          tierName: tier?.name || 'Standard',
        });
        customImageUrl = '';
      } catch {
        /* fall back to plain QR email */
      }
    }

    try {
      await this.resendService.sendTicketEmail({
        toEmail: ticket.attendeeEmail,
        customerName: ticket.attendeeName || 'Guest',
        eventName: event.title,
        eventDate: new Date(event.startDate).toLocaleString(),
        eventLocation: event.location,
        ticketNumber: ticket.ticketNumber,
        tierName: tier?.name || 'Standard',
        qrCodeHash: qrCodeUrl,
        ticketImageUrl: customImageUrl,
        ticketImageBuffer,
        ticketPdfBuffer,
        qrCodeDelivery,
        walletUrl,
      });
      ticket.emailSent = true;
    } catch {
      ticket.emailSent = false;
    }
    await ticket.save();
  }

  async resendTicketEmail(ticketId: string, tenantId: string, newEmail?: string) {
    const ticket = await this.ticketModel.findById(ticketId).populate('eventId').exec();
    if (!ticket) throw new NotFoundException('Ticket not found');

    const event = ticket.eventId as any as EventDocument;
    if (!event || event.tenantId.toString() !== tenantId.toString()) {
      throw new ForbiddenException('This ticket does not belong to your organization');
    }
    if (newEmail) {
      if (!newEmail.includes('@')) throw new BadRequestException('A valid email is required');
      ticket.attendeeEmail = newEmail.toLowerCase().trim();
    }
    if (!ticket.attendeeEmail) {
      throw new BadRequestException('This ticket has no attendee email');
    }

    const tenant = await this.tenantModel.findById(tenantId);
    const order = await this.orderModel.findById(ticket.orderId);
    const walletUrl = order
      ? `${(process.env.FRONTEND_URL || 'https://ticketr.org').replace(/\/+$/, '')}/my-tickets?token=${order.walletToken}`
      : '';

    await this.sendTicketEmail(ticket, event, tenant, walletUrl);
    if (!ticket.emailSent) {
      throw new BadRequestException('The email provider rejected the message. Please retry.');
    }
    return { success: true, sentTo: ticket.attendeeEmail };
  }

  // ---------------------------------------------------------------------------
  // Tier changes (organizer)
  // ---------------------------------------------------------------------------

  private generateTicketNumber(
    tierName: string,
    ticketIndex: number,
    departmentCode: string | undefined,
    event: EventDocument,
  ): string {
    const prefix = tierName.toUpperCase().includes('VIP')
      ? tierName.toUpperCase().includes('VVIP')
        ? 'VV'
        : 'V'
      : tierName.toUpperCase().includes('TABLE')
        ? 'TBL'
        : 'R';
    const slug = (event.slug || 'TIX').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const eventCode = `${(slug + 'XXX').slice(0, 4)}${event._id.toString().slice(-3).toUpperCase()}`;
    const index = ticketIndex < 10 ? `0${ticketIndex}` : `${ticketIndex}`;
    const dept = (departmentCode || 'GEN').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    return `${prefix}/${eventCode}/T${index}/${dept || 'GEN'}`;
  }

  async changeTicketTier(
    ticketId: string,
    newTierId: string,
    tenantId: string,
    adminUserId: string,
  ) {
    const ticket = await this.ticketModel.findById(ticketId);
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status !== TicketStatus.ISSUED) {
      throw new BadRequestException('Only unused tickets can be moved between tiers');
    }

    const event = await this.eventModel.findById(ticket.eventId);
    if (!event || event.tenantId.toString() !== tenantId.toString()) {
      throw new ForbiddenException('This ticket does not belong to your organization');
    }
    if (ticket.tierId.toString() === newTierId) {
      throw new BadRequestException('This ticket is already in that tier');
    }

    const [oldTier, newTier] = await Promise.all([
      this.ticketTierModel.findById(ticket.tierId),
      this.ticketTierModel.findById(newTierId),
    ]);
    if (!newTier) throw new NotFoundException('New ticket tier not found');
    if (newTier.eventId.toString() !== event._id.toString()) {
      throw new BadRequestException('The new tier belongs to a different event');
    }

    // Atomically claim a seat in the new tier.
    const claimed = await this.ticketTierModel.findOneAndUpdate(
      {
        _id: newTierId,
        isActive: true,
        $expr: {
          $lte: [
            { $add: ['$soldCount', { $ifNull: ['$reservedCount', 0] }, 1] },
            '$capacity',
          ],
        },
      },
      { $inc: { soldCount: 1 } },
      { new: true },
    );
    if (!claimed) throw new BadRequestException('The destination tier is sold out');

    if (oldTier) {
      await this.ticketTierModel.updateOne(
        { _id: oldTier._id, soldCount: { $gt: 0 } },
        { $inc: { soldCount: -1 } },
      );
    }

    const order = await this.orderModel.findById(ticket.orderId);
    if (order) {
      const oldItem = order.items.find((i) => i.tierId.toString() === ticket.tierId.toString());
      const newItem = order.items.find((i) => i.tierId.toString() === newTierId);

      if (oldItem) {
        if (oldItem.quantity <= 1) {
          order.items = order.items.filter(
            (i) => i.tierId.toString() !== ticket.tierId.toString(),
          ) as any;
        } else {
          oldItem.quantity -= 1;
          oldItem.subtotal = oldItem.unitPrice * oldItem.quantity;
        }
      }

      if (newItem) {
        newItem.quantity += 1;
        newItem.subtotal = newItem.unitPrice * newItem.quantity;
      } else {
        order.items.push({
          tierId: newTier._id.toString(),
          tierName: newTier.name,
          unitPrice: Number(newTier.price),
          quantity: 1,
          subtotal: Number(newTier.price),
          markupAmount: 0,
          reservedUnits: 1,
          attendees: [
            {
              name: ticket.attendeeName || order.customerName,
              email: ticket.attendeeEmail || order.customerEmail,
              departmentCode: ticket.departmentCode,
            },
          ],
        } as any);
      }

      const newTotal = order.items.reduce((sum, item) => sum + item.subtotal, 0);
      order.totalAmount = Math.max(0, Math.round(newTotal * 100) / 100);
      order.amountRemaining = Math.max(
        0,
        Math.round((order.totalAmount - (order.amountPaid || 0)) * 100) / 100,
      );
      if (order.amountRemaining > 0) order.status = OrderStatus.PARTIALLY_PAID;
      order.updatedBy = adminUserId;
      await order.save();
    }

    const previousHash = ticket.qrCodeHash;
    ticket.tierId = newTierId;
    ticket.ticketNumber = this.generateTicketNumber(
      newTier.name,
      claimed.soldCount,
      ticket.departmentCode,
      event,
    );
    ticket.qrCodeHash = crypto
      .createHash('sha256')
      .update(`${ticket.orderId}-${ticket.ticketNumber}-${Date.now()}-${Math.random()}-TIER_CHANGED`)
      .digest('hex');
    ticket.emailSent = false;
    await ticket.save();

    try {
      await this.redisService.del(`ticket:scan:${previousHash}`);
    } catch {
      /* ignore */
    }

    const tenant = await this.tenantModel.findById(tenantId);
    const walletUrl = order
      ? `${(process.env.FRONTEND_URL || 'https://ticketr.org').replace(/\/+$/, '')}/my-tickets?token=${order.walletToken}`
      : '';
    await this.sendTicketEmail(ticket, event, tenant, walletUrl);

    return {
      success: true,
      ticket,
      orderStatus: order?.status,
      priceDifference: Number(newTier.price) - Number(oldTier?.price || 0),
    };
  }

  // ---------------------------------------------------------------------------
  // Verified resale marketplace
  // ---------------------------------------------------------------------------

  private priceCap(event: EventDocument, tier: TicketTierDocument | null): number {
    const face = Number(tier?.price || 0);
    const capPercent = event.resalePriceCapPercent ?? 100;
    return Math.round(face * (capPercent / 100) * 100) / 100;
  }

  async createResaleListing(ticketId: string, ctx: AccessContext, askingPrice: number) {
    const ticket = await this.ticketModel.findById(ticketId);
    if (!ticket) throw new NotFoundException('Ticket not found');
    await this.assertTicketAccess(ticket, ctx);

    const event = await this.eventModel.findById(ticket.eventId);
    if (!event) throw new NotFoundException('Event not found');
    if (!event.resaleEnabled) throw new BadRequestException('Resale is disabled for this event');
    if (ticket.status !== TicketStatus.ISSUED) {
      throw new BadRequestException('Only unused tickets can be listed for resale');
    }
    if (new Date(event.startDate).getTime() < Date.now() + 60 * 60 * 1000) {
      throw new BadRequestException('Resale closes one hour before the event starts');
    }

    const existing = await this.resaleModel.findOne({
      ticketId: ticket._id,
      status: ResaleStatus.AVAILABLE,
    });
    if (existing) throw new BadRequestException('This ticket is already listed for resale');

    const tier = await this.ticketTierModel.findById(ticket.tierId);
    const cap = this.priceCap(event, tier);
    const price = Math.round(Number(askingPrice) * 100) / 100;
    if (!Number.isFinite(price) || price <= 0) {
      throw new BadRequestException('Enter a valid asking price');
    }
    if (price > cap) {
      throw new BadRequestException(
        `This event caps resale at ₦${cap.toLocaleString()} (${event.resalePriceCapPercent ?? 100}% of face value).`,
      );
    }

    const listing = await this.resaleModel.create({
      ticketId: ticket._id.toString(),
      eventId: ticket.eventId.toString(),
      sellerId: ctx.userId || ticket.currentOwnerId || ticket.orderId,
      askingPrice: price,
      status: ResaleStatus.AVAILABLE,
    });

    ticket.resaleListingId = listing._id.toString();
    await ticket.save();

    return {
      id: listing._id.toString(),
      askingPrice: price,
      cap,
      status: listing.status,
      message: 'Listed. Your original QR code stays valid until a buyer completes payment.',
    };
  }

  async cancelResaleListing(listingId: string, ctx: AccessContext) {
    const listing = await this.resaleModel.findById(listingId);
    if (!listing) throw new NotFoundException('Listing not found');
    const ticket = await this.ticketModel.findById(listing.ticketId);
    if (!ticket) throw new NotFoundException('Ticket not found');
    await this.assertTicketAccess(ticket, ctx);

    if (listing.status !== ResaleStatus.AVAILABLE) {
      throw new BadRequestException('This listing can no longer be cancelled');
    }
    listing.status = ResaleStatus.CANCELLED;
    await listing.save();
    ticket.resaleListingId = undefined;
    await ticket.save();
    return { success: true };
  }

  async getResaleListings(eventId: string) {
    const listings = await this.resaleModel
      .find({ eventId, status: ResaleStatus.AVAILABLE })
      .sort({ createdAt: 1 })
      .exec();

    const results: any[] = [];
    for (const listing of listings) {
      const ticket = await this.ticketModel.findById(listing.ticketId).populate('tierId').exec();
      if (!ticket || ticket.status !== TicketStatus.ISSUED) continue;
      results.push({
        id: listing._id.toString(),
        askingPrice: listing.askingPrice,
        tierName: (ticket.tierId as any)?.name || 'Standard',
        section: ticket.departmentCode || null,
        createdAt: (listing as any).createdAt,
      });
    }
    return results;
  }

  async getListingForPurchase(listingId: string) {
    const listing = await this.resaleModel.findById(listingId);
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.status !== ResaleStatus.AVAILABLE) {
      throw new BadRequestException('This ticket has already been sold');
    }
    const ticket = await this.ticketModel.findById(listing.ticketId).populate('tierId');
    if (!ticket || ticket.status !== TicketStatus.ISSUED) {
      throw new BadRequestException('This listing is no longer available');
    }
    const event = await this.eventModel.findById(listing.eventId);
    if (!event) throw new NotFoundException('Event not found');
    return { listing, ticket, event };
  }

  async initializeResaleCheckout(
    listingId: string,
    buyerName: string,
    buyerEmail: string,
    callbackUrl: string,
  ) {
    if (!buyerName?.trim() || !buyerEmail?.includes('@')) {
      throw new BadRequestException('Buyer name and email are required');
    }
    const { listing } = await this.getListingForPurchase(listingId);

    const reference = `RSL-${listing._id.toString()}-${Date.now().toString(36)}`;
    const resp = await this.paystackService.initializeTransaction({
      email: buyerEmail.toLowerCase().trim(),
      amountInKobo: Math.round(listing.askingPrice * 100),
      reference,
      callbackUrl,
      metadata: {
        type: 'RESALE',
        listingId: listing._id.toString(),
        buyerName: buyerName.trim(),
        buyerEmail: buyerEmail.toLowerCase().trim(),
      },
    });

    listing.paymentReference = reference;
    listing.paymentStatus = 'PENDING';
    listing.buyerName = buyerName.trim();
    listing.buyerEmail = buyerEmail.toLowerCase().trim();
    await listing.save();

    return {
      authorizationUrl: resp.authorization_url,
      reference,
      amount: listing.askingPrice,
      listingId: listing._id.toString(),
    };
  }

  async verifyResalePayment(reference: string) {
    const listing = await this.resaleModel.findOne({ paymentReference: reference });
    if (!listing) throw new NotFoundException('Resale checkout not found');
    if (listing.status === ResaleStatus.SOLD) {
      return { success: true, alreadyCompleted: true };
    }
    if (listing.paymentStatus === 'PAID') {
      const result = await this.completeResale(
        listing._id.toString(),
        listing.buyerName || 'Buyer',
        listing.buyerEmail || '',
      );
      return result;
    }

    const verification = await this.paystackService.verifyTransaction(reference);
    const paid = verification?.data?.status === 'success';
    const amount = Number(verification?.data?.amount || 0);
    if (!paid) {
      listing.paymentStatus = 'FAILED';
      await listing.save();
      throw new BadRequestException('Resale payment was not completed');
    }
    const isMockGateway = String(process.env.PAYSTACK_SECRET_KEY || '').startsWith('sk_test_mock');
    if (!isMockGateway && amount + 1 < Math.round(listing.askingPrice * 100)) {
      listing.paymentStatus = 'FAILED';
      await listing.save();
      throw new BadRequestException('The resale payment amount did not match the listing price');
    }

    listing.paymentStatus = 'PAID';
    await listing.save();

    const result = await this.completeResale(
      listing._id.toString(),
      listing.buyerName || 'Buyer',
      listing.buyerEmail || '',
    );
    return result;
  }

  async completeResale(listingId: string, buyerName: string, buyerEmail: string) {
    const { listing, ticket } = await this.getListingForPurchase(listingId);
    const event = await this.eventModel.findById(listing.eventId);
    if (!event) throw new NotFoundException('Event not found');

    const previousHash = ticket.qrCodeHash;
    ticket.attendeeName = buyerName;
    ticket.attendeeEmail = buyerEmail.toLowerCase();
    ticket.currentOwnerId = (listing as any).buyerId;
    ticket.qrCodeHash = crypto
      .createHash('sha256')
      .update(`${ticket.orderId}-${ticket.ticketNumber}-${Date.now()}-${Math.random()}-RESALE`)
      .digest('hex');
    ticket.transferCount = (ticket.transferCount || 0) + 1;
    ticket.lastTransferredAt = new Date();
    ticket.resaleListingId = undefined;
    ticket.emailSent = false;
    await ticket.save();

    listing.status = ResaleStatus.SOLD;
    listing.soldAt = new Date();
    const sellerPayout = Math.round(listing.askingPrice * 0.9 * 100) / 100;
    listing.sellerPayout = sellerPayout;
    listing.platformFee = Math.round((listing.askingPrice - sellerPayout) * 100) / 100;
    await listing.save();

    try {
      await this.redisService.del(`ticket:scan:${previousHash}`);
    } catch {
      /* ignore */
    }

    const originalOrder = await this.orderModel.findById(ticket.orderId);
    const tenant = originalOrder
      ? await this.tenantModel.findById(originalOrder.tenantId)
      : null;

    // Give the buyer their own order + wallet. Without this the resale buyer
    // would only have an email and no private wallet to open the pass.
    const tier = await this.ticketTierModel.findById(ticket.tierId);
    const walletToken = crypto.randomBytes(24).toString('hex');
    const resaleOrder = await this.orderModel.create({
      tenantId: ticket.tenantId,
      eventId: ticket.eventId,
      orderNumber: `RSL-${Date.now().toString(36).toUpperCase()}-${crypto
        .randomBytes(2)
        .toString('hex')
        .toUpperCase()}`,
      customerName: buyerName,
      customerEmail: buyerEmail.toLowerCase(),
      departmentCode: ticket.departmentCode,
      items: [
        {
          tierId: ticket.tierId,
          tierName: tier?.name || 'Resale ticket',
          unitPrice: listing.askingPrice,
          quantity: 1,
          subtotal: listing.askingPrice,
          markupAmount: 0,
          reservedUnits: 1,
          attendees: [
            {
              name: buyerName,
              email: buyerEmail,
              departmentCode: ticket.departmentCode,
            },
          ],
        },
      ],
      totalAmount: listing.askingPrice,
      platformFee: listing.platformFee,
      netToOrganizer: Math.max(0, listing.askingPrice - (listing.platformFee || 0)),
      currency: 'NGN',
      status: OrderStatus.PAID,
      paidAt: new Date(),
      paymentMethod: 'RESALE',
      walletToken,
      fulfillmentStatus: 'DONE',
      reservationState: 'NONE',
      channel: 'RESALE',
      amountPaid: listing.askingPrice,
      amountRemaining: 0,
      paymentReference: listing.paymentReference,
    });

    ticket.orderId = resaleOrder._id.toString();
    ticket.emailSent = false;
    await ticket.save();

    const frontend = (process.env.FRONTEND_URL || 'https://ticketr.org').replace(/\/+$/, '');
    const walletUrl = `${frontend}/my-tickets?token=${walletToken}`;
    await this.sendTicketEmail(ticket, event, tenant, walletUrl);

    return {
      success: true,
      ticketNumber: ticket.ticketNumber,
      sellerPayout,
      platformFee: listing.platformFee,
      walletToken,
      orderNumber: resaleOrder.orderNumber,
    };
  }
}
