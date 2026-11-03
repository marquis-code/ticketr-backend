import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId, Types } from 'mongoose';
import {
  Event,
  EventDocument,
  EventStatus,
  EventVisibility,
  MarkupFeeType,
  MarkupStrategy,
  QrCodeDeliveryStrategy,
} from '../schemas/event.schema';
import { TicketTier, TicketTierDocument } from '../schemas/ticket-tier.schema';
import { Tenant, TenantDocument } from '../schemas/tenant.schema';
import { Ticket, TicketDocument, TicketStatus } from '../schemas/ticket.schema';
import { Order, OrderDocument, OrderStatus } from '../schemas/order.schema';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

function escapeRegex(input: string): string {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class EventService {
  constructor(
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    @InjectModel(TicketTier.name) private ticketTierModel: Model<TicketTierDocument>,
    @InjectModel(Tenant.name) private tenantModel: Model<TenantDocument>,
    @InjectModel(Ticket.name) private ticketModel: Model<TicketDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    private cloudinaryService: CloudinaryService,
  ) {}

  // ---------------------------------------------------------------------------
  // Projections
  // ---------------------------------------------------------------------------

  /**
   * Honest availability: physical tickets already issued plus live checkout
   * holds. `soldCount` alone under-reports because group tickets create many
   * tickets per unit and abandoned carts hold stock for 30 minutes.
   */
  private tierView(tier: TicketTierDocument) {
    const sold = tier.soldCount || 0;
    const reserved = tier.reservedCount || 0;
    const remaining = Math.max(0, tier.capacity - sold - reserved);
    return {
      _id: tier._id,
      name: tier.name,
      description: tier.description,
      price: tier.price,
      capacity: tier.capacity,
      soldCount: sold,
      reservedCount: reserved,
      remaining,
      soldOut: remaining <= 0,
      sellThrough: tier.capacity > 0 ? Math.round((sold / tier.capacity) * 100) : 0,
      maxPerPurchase: tier.maxPerPurchase || 5,
      isCoupleTicket: !!tier.isCoupleTicket,
      isActive: tier.isActive,
      templateImageUrl: tier.templateImageUrl,
      salesStartAt: tier.salesStartAt,
      salesEndAt: tier.salesEndAt,
      markupFee: tier.markupFee,
      markupFeeType: tier.markupFeeType,
      markupStrategy: tier.markupStrategy,
    };
  }

  /** Strip promo codes, internal ids and creator data from public payloads. */
  private publicEvent(event: EventDocument | any, extras: Record<string, any> = {}) {
    const e =
      typeof (event as any).toObject === 'function' ? (event as any).toObject() : { ...(event as any) };
    return {
      _id: e._id,
      title: e.title,
      slug: e.slug,
      description: e.description,
      bannerUrl: e.bannerUrl,
      carouselImages: e.carouselImages || [],
      galleryImages: e.galleryImages || [],
      location: e.location,
      isVirtual: e.isVirtual,
      startDate: e.startDate,
      endDate: e.endDate,
      status: e.status,
      tags: e.tags || [],
      capacity: e.capacity,
      formSettings: {
        requireDepartment: e.formSettings?.requireDepartment ?? true,
        departmentLabel: e.formSettings?.departmentLabel || 'Department / Association',
        departmentOptions: e.formSettings?.departmentOptions || [],
        customFields: e.formSettings?.customFields || [],
      },
      resaleEnabled: e.resaleEnabled,
      resalePriceCapPercent: e.resalePriceCapPercent,
      transferPolicy: e.transferPolicy,
      refundPolicy: e.refundPolicy,
      venueMapUrl: e.venueMapUrl,
      qrCodeDelivery: e.qrCodeDelivery,
      checkInStart: e.checkInStart,
      checkInEnd: e.checkInEnd,
      ...extras,
    };
  }

  private publicTenant(tenant: TenantDocument) {
    return {
      id: tenant._id.toString(),
      name: tenant.name,
      slug: tenant.slug,
      logoUrl: tenant.logoUrl,
      primaryColor: tenant.primaryColor,
      secondaryColor: tenant.secondaryColor,
      contactEmail: tenant.contactEmail,
      contactPhone: tenant.contactPhone,
    };
  }

  private metadata(total: number, page: number, limit: number, extra: Record<string, any> = {}) {
    return {
      total,
      page,
      limit,
      lastPage: Math.max(1, Math.ceil(total / limit)),
      ...extra,
    };
  }

  // ---------------------------------------------------------------------------
  // Create / update
  // ---------------------------------------------------------------------------

  async createEvent(
    userId: string,
    tenantId: string,
    dto: {
      title: string;
      slug: string;
      description: string;
      location: string;
      isVirtual?: boolean;
      startDate: Date;
      endDate: Date;
      checkInStart?: Date;
      checkInEnd?: Date;
      tags?: string[];
      carouselImages?: string[];
      tiers: Array<{
        name: string;
        description?: string;
        price: number;
        capacity: number;
        maxPerPurchase?: number;
        isCoupleTicket?: boolean;
        markupFee?: number;
        markupFeeType?: MarkupFeeType;
        markupStrategy?: MarkupStrategy;
      }>;
      formSettings?: any;
      qrCodeDelivery?: string;
      status?: EventStatus;
      resaleEnabled?: boolean;
      resalePriceCapPercent?: number;
      transferPolicy?: string;
      refundPolicy?: string;
    },
    files?: Express.Multer.File[],
  ) {
    if (!dto.title?.trim()) throw new BadRequestException('Event title is required');
    if (!dto.description?.trim()) throw new BadRequestException('Event description is required');
    if (!dto.location?.trim()) throw new BadRequestException('Event location is required');
    if (!dto.startDate || !dto.endDate) throw new BadRequestException('Start and end dates are required');
    if (new Date(dto.endDate) <= new Date(dto.startDate)) {
      throw new BadRequestException('The event must end after it starts');
    }
    if (dto.checkInStart && dto.checkInEnd && new Date(dto.checkInEnd) <= new Date(dto.checkInStart)) {
      throw new BadRequestException('Check-in close time must be after check-in open time');
    }
    if (!Array.isArray(dto.tiers) || dto.tiers.length === 0) {
      throw new BadRequestException('Add at least one ticket tier');
    }

    let bannerUrl: string | undefined;
    let carouselImages: string[] = dto.carouselImages || [];

    if (files?.length) {
      const uploadedUrls = await Promise.all(
        files.map((file) => this.cloudinaryService.uploadImage(file, 'ticketr/events')),
      );
      bannerUrl = uploadedUrls[0];
      carouselImages = [...carouselImages, ...uploadedUrls];
    }

    const cleanSlug =
      (dto.slug || dto.title)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || `event-${Date.now().toString(36)}`;

    const existing = await this.eventModel.findOne({ tenantId, slug: cleanSlug });
    if (existing) {
      throw new BadRequestException(
        `An event with the link “${cleanSlug}” already exists. Choose a different event link.`,
      );
    }

    const validatedTiers = this.validateTiers(dto.tiers);
    const totalCapacity = validatedTiers.reduce((sum, tier) => sum + tier.capacity, 0);

    const event = await this.eventModel.create({
      tenantId,
      title: dto.title.trim(),
      slug: cleanSlug,
      description: dto.description.trim(),
      location: dto.location.trim(),
      isVirtual: !!dto.isVirtual,
      startDate: dto.startDate,
      endDate: dto.endDate,
      checkInStart: dto.checkInStart,
      checkInEnd: dto.checkInEnd,
      tags: (dto.tags || []).map((t) => t.trim()).filter(Boolean),
      status: dto.status === EventStatus.DRAFT ? EventStatus.DRAFT : EventStatus.PUBLISHED,
      visibility: EventVisibility.PUBLIC,
      capacity: totalCapacity,
      bannerUrl,
      carouselImages,
      formSettings: dto.formSettings || undefined,
      qrCodeDelivery: (dto.qrCodeDelivery as QrCodeDeliveryStrategy) || 'STAMP_ON_TICKET',
      resaleEnabled: dto.resaleEnabled !== false,
      resalePriceCapPercent:
        dto.resalePriceCapPercent !== undefined
          ? Math.min(100, Math.max(0, Number(dto.resalePriceCapPercent)))
          : 100,
      transferPolicy: dto.transferPolicy,
      refundPolicy: dto.refundPolicy,
      createdBy: userId,
    });

    await this.ticketTierModel.insertMany(
      validatedTiers.map((t) => ({ ...t, eventId: event._id.toString() })),
    );

    return this.getEventWithTiers(event._id.toString(), tenantId);
  }

  private validateTiers(tiers: any[]) {
    const names = new Set<string>();
    return tiers.map((t, index) => {
      const name = String(t.name || '').trim();
      if (!name) throw new BadRequestException(`Ticket tier ${index + 1} needs a name`);
      if (names.has(name.toLowerCase())) {
        throw new BadRequestException(`Duplicate ticket tier name: ${name}`);
      }
      names.add(name.toLowerCase());

      const price = Number(t.price);
      const capacity = Math.floor(Number(t.capacity));
      if (!Number.isFinite(price) || price < 0) {
        throw new BadRequestException(`Ticket tier “${name}” needs a valid price`);
      }
      if (!Number.isFinite(capacity) || capacity < 1) {
        throw new BadRequestException(`Ticket tier “${name}” needs a capacity of at least 1`);
      }
      const maxPerPurchase = Math.floor(Number(t.maxPerPurchase) || 5);
      if (maxPerPurchase < 1 || maxPerPurchase > capacity) {
        throw new BadRequestException(
          `Max tickets per order for “${name}” must be between 1 and ${capacity}`,
        );
      }

      return {
        name,
        description: t.description || '',
        price,
        capacity,
        maxPerPurchase,
        isActive: t.isActive !== false,
        isCoupleTicket: !!t.isCoupleTicket,
        markupFee: Number(t.markupFee) || 0,
        markupFeeType: t.markupFeeType || MarkupFeeType.FLAT,
        markupStrategy: t.markupStrategy || MarkupStrategy.ADD_TO_FEE,
        salesStartAt: t.salesStartAt,
        salesEndAt: t.salesEndAt,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Public reads
  // ---------------------------------------------------------------------------

  async getAllPublicEvents(page = 1, limit = 20, search?: string, tag?: string, includePast = false) {
    page = Math.max(1, Number(page) || 1);
    limit = Math.min(48, Math.max(1, Number(limit) || 20));

    const now = new Date();
    const filter: any = {
      status: EventStatus.PUBLISHED,
      visibility: { $in: [EventVisibility.PUBLIC, null] },
    };
    if (!includePast) filter.endDate = { $gte: now };
    if (search?.trim()) {
      const rx = new RegExp(escapeRegex(search.trim().slice(0, 80)), 'i');
      filter.$or = [{ title: rx }, { description: rx }, { tags: rx }, { location: rx }];
    }
    if (tag?.trim()) filter.tags = tag.trim();

    const [events, totalCount] = await Promise.all([
      this.eventModel
        .find(filter)
        .sort({ startDate: includePast ? -1 : 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.eventModel.countDocuments(filter),
    ]);

    const data = await Promise.all(
      events.map(async (ev) => {
        const [tiers, tenant] = await Promise.all([
          this.ticketTierModel.find({ eventId: ev._id.toString(), isActive: true }).exec(),
          this.tenantModel.findById(ev.tenantId).lean().exec(),
        ]);
        const tierViews = tiers.map((t) => this.tierView(t));
        return this.publicEvent(ev as any, {
          tiers: tierViews,
          remaining: tierViews.reduce((sum, t) => sum + t.remaining, 0),
          lowestPrice: tierViews.length ? Math.min(...tierViews.map((t) => t.price)) : 0,
          organizer: tenant
            ? { name: (tenant as any).name, slug: (tenant as any).slug, logoUrl: (tenant as any).logoUrl }
            : null,
          tenant: tenant
            ? { name: (tenant as any).name, slug: (tenant as any).slug, logoUrl: (tenant as any).logoUrl }
            : null,
        });
      }),
    );

    const tags = await this.eventModel.distinct('tags', {
      status: EventStatus.PUBLISHED,
      endDate: { $gte: now },
    });

    return {
      events: {
        data,
        metadata: this.metadata(totalCount, page, limit, {
          tags: (tags || []).filter(Boolean).slice(0, 24),
        }),
      },
    };
  }

  async getEventsByTenantSlug(tenantSlug: string, page = 1, limit = 20, search?: string, includePast = false) {
    const tenant = await this.tenantModel.findOne({ slug: tenantSlug.toLowerCase() });
    if (!tenant) throw new NotFoundException(`Organizer '${tenantSlug}' not found`);
    if (tenant.status !== 'ACTIVE') {
      throw new NotFoundException('This organizer is not currently available');
    }

    page = Math.max(1, Number(page) || 1);
    limit = Math.min(48, Math.max(1, Number(limit) || 20));

    const filter: any = { tenantId: tenant._id.toString(), status: EventStatus.PUBLISHED };
    if (!includePast) filter.endDate = { $gte: new Date() };
    if (search?.trim()) {
      const rx = new RegExp(escapeRegex(search.trim().slice(0, 80)), 'i');
      filter.$or = [{ title: rx }, { description: rx }, { tags: rx }];
    }

    const [events, totalCount] = await Promise.all([
      this.eventModel
        .find(filter)
        .sort({ startDate: includePast ? -1 : 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.eventModel.countDocuments(filter),
    ]);

    const data = await Promise.all(
      events.map(async (ev) => {
        const tiers = await this.ticketTierModel.find({ eventId: ev._id.toString(), isActive: true }).exec();
        const tierViews = tiers.map((t) => this.tierView(t));
        return this.publicEvent(ev, {
          tiers: tierViews,
          remaining: tierViews.reduce((sum, t) => sum + t.remaining, 0),
          lowestPrice: tierViews.length ? Math.min(...tierViews.map((t) => t.price)) : 0,
          tenant: { name: tenant.name, slug: tenant.slug, logoUrl: tenant.logoUrl },
        });
      }),
    );

    return {
      tenant: this.publicTenant(tenant),
      events: { data, metadata: this.metadata(totalCount, page, limit) },
    };
  }

  async getEventBySlug(tenantSlug: string, eventSlug: string) {
    const tenant = await this.tenantModel.findOne({ slug: tenantSlug.toLowerCase() });
    if (!tenant) throw new NotFoundException(`Organizer '${tenantSlug}' not found`);
    if (tenant.status !== 'ACTIVE') throw new NotFoundException('This organizer is not available');

    const event = await this.eventModel.findOne({
      tenantId: tenant._id.toString(),
      slug: eventSlug.toLowerCase(),
      status: {
        $in: [EventStatus.PUBLISHED, EventStatus.CANCELLED, EventStatus.COMPLETED],
      },
    });
    if (!event) throw new NotFoundException(`Event '${eventSlug}' not found`);

    const tiers = await this.ticketTierModel
      .find({ eventId: event._id.toString(), isActive: true })
      .sort({ price: 1 })
      .exec();

    const tierViews = tiers.map((t) => this.tierView(t));

    return {
      tenant: {
        ...this.publicTenant(tenant),
        paymentMethod: tenant.paymentMethod || 'PAYSTACK',
        // Manual-transfer organizers must show their receiving account to buyers.
        primaryRemittanceAccount:
          tenant.paymentMethod === 'MANUAL_TRANSFER'
            ? tenant.primaryRemittanceAccount || tenant.remittanceAccount
            : undefined,
      },
      event: this.publicEvent(event, {
        tiers: tierViews,
        remaining: tierViews.reduce((sum, t) => sum + t.remaining, 0),
        lowestPrice: tierViews.length ? Math.min(...tierViews.map((t) => t.price)) : 0,
        highestPrice: tierViews.length ? Math.max(...tierViews.map((t) => t.price)) : 0,
        isPast: new Date(event.endDate).getTime() < Date.now(),
      }),
    };
  }

  /** Public lookup by event slug alone (used by shared links and the wallet). */
  async getPublicEventBySlug(eventSlug: string) {
    let slug = '';
    try {
      slug = decodeURIComponent(eventSlug || '').toLowerCase();
    } catch {
      throw new BadRequestException('Invalid event link');
    }
    if (!slug) throw new NotFoundException('Event not found');

    const event = await this.eventModel
      .findOne({
        slug,
        status: EventStatus.PUBLISHED,
        endDate: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      })
      .sort({ startDate: 1 });

    if (!event) throw new NotFoundException(`Event '${eventSlug}' not found`);
    const tenant = await this.tenantModel.findById(event.tenantId);
    if (!tenant) throw new NotFoundException('Organizer for this event is no longer available');
    return this.getEventBySlug(tenant.slug, slug);
  }

  // ---------------------------------------------------------------------------
  // Organizer reads
  // ---------------------------------------------------------------------------

  async getEventWithTiers(eventId: string, tenantId?: string) {
    if (!isValidObjectId(eventId)) throw new BadRequestException('Invalid event ID');
    const event = await this.eventModel.findById(eventId);
    if (!event || (tenantId && event.tenantId.toString() !== tenantId.toString())) {
      throw new NotFoundException('Event not found');
    }
    const tiers = await this.ticketTierModel.find({ eventId }).sort({ price: 1 }).exec();
    return { ...event.toObject(), tiers: tiers.map((t) => this.tierView(t)) };
  }

  async getTenantEventsForAdmin(
    tenantId: string,
    page = 1,
    limit = 20,
    search?: string,
    status?: string,
  ) {
    page = Math.max(1, Number(page) || 1);
    limit = Math.min(100, Math.max(1, Number(limit) || 20));

    const filter: any = { tenantId };
    if (status && status !== 'ALL') filter.status = status;
    if (search?.trim()) {
      const rx = new RegExp(escapeRegex(search.trim().slice(0, 80)), 'i');
      filter.$or = [{ title: rx }, { location: rx }, { tags: rx }];
    }

    const [events, totalCount, activeEventsCount] = await Promise.all([
      this.eventModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.eventModel.countDocuments(filter),
      this.eventModel.countDocuments({ tenantId, status: EventStatus.PUBLISHED }),
    ]);

    const eventIds = events.map((ev) => ev._id);
    const [revenueRows, checkInRows] = await Promise.all([
      this.orderModel.aggregate([
        {
          $match: {
            tenantId: new Types.ObjectId(tenantId),
            eventId: { $in: eventIds },
            channel: { $ne: 'RESALE' },
            status: { $in: [OrderStatus.PAID, OrderStatus.PARTIALLY_PAID] },
          },
        },
        {
          $group: {
            _id: '$eventId',
            revenue: { $sum: { $ifNull: ['$amountPaid', '$totalAmount'] } },
            orders: { $sum: 1 },
          },
        },
      ]),
      this.ticketModel.aggregate([
        { $match: { eventId: { $in: eventIds }, status: TicketStatus.CHECKED_IN } },
        { $group: { _id: '$eventId', checkedIn: { $sum: 1 } } },
      ]),
    ]);
    const revenueByEvent = new Map(revenueRows.map((row) => [String(row._id), row]));
    const checkedInByEvent = new Map(checkInRows.map((row) => [String(row._id), row.checkedIn]));

    const data = await Promise.all(
      events.map(async (ev) => {
        const tiers = await this.ticketTierModel.find({ eventId: ev._id.toString() }).exec();
        const tierViews = tiers.map((t) => this.tierView(t));
        const revenue = revenueByEvent.get(ev._id.toString()) as any;
        return {
          ...ev.toObject(),
          tiers: tierViews,
          totalCapacity: tiers.reduce((sum, t) => sum + t.capacity, 0),
          totalSold: tiers.reduce((sum, t) => sum + (t.soldCount || 0), 0),
          totalReserved: tiers.reduce((sum, t) => sum + (t.reservedCount || 0), 0),
          revenue: revenue?.revenue || 0,
          orderCount: revenue?.orders || 0,
          checkedIn: checkedInByEvent.get(ev._id.toString()) || 0,
        };
      }),
    );

    return {
      data,
      metadata: this.metadata(totalCount, page, limit, {
        statistics: { totalEvents: totalCount, activeEvents: activeEventsCount },
      }),
    };
  }

  async getEventAttendees(
    eventId: string,
    tenantId: string,
    page = 1,
    limit = 20,
    search?: string,
    status?: string,
    departmentCode?: string,
  ) {
    const event = await this.eventModel.findOne({ _id: eventId, tenantId });
    if (!event) throw new NotFoundException('Event not found');

    page = Math.max(1, Number(page) || 1);
    limit = Math.min(200, Math.max(1, Number(limit) || 20));

    const filter: any = { eventId };
    if (search?.trim()) {
      const rx = new RegExp(escapeRegex(search.trim().slice(0, 80)), 'i');
      filter.$or = [{ attendeeName: rx }, { attendeeEmail: rx }, { ticketNumber: rx }];
    }
    if (status && status !== 'ALL') filter.status = status;
    if (departmentCode && departmentCode !== 'ALL') filter.departmentCode = departmentCode;

    const [tickets, totalCount, statusAgg, departmentRows] = await Promise.all([
      this.ticketModel
        .find(filter)
        .populate('tierId')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.ticketModel.countDocuments(filter),
      this.ticketModel.aggregate([
        { $match: { eventId: event._id } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      this.ticketModel.distinct('departmentCode', { eventId: event._id }),
    ]);

    const totalTickets = statusAgg.reduce((sum, row) => sum + row.count, 0);
    const checkedInCount = statusAgg.find((row) => row._id === TicketStatus.CHECKED_IN)?.count || 0;

    return {
      event: {
        id: event._id.toString(),
        title: event.title,
        startDate: event.startDate,
        endDate: event.endDate,
        location: event.location,
        status: event.status,
      },
      attendees: {
        data: tickets,
        metadata: this.metadata(totalCount, page, limit, {
          statistics: {
            totalTickets,
            checkedInCount,
            pendingCount: totalTickets - checkedInCount,
            checkInRate: totalTickets ? Math.round((checkedInCount / totalTickets) * 100) : 0,
            availableDepartments: ['ALL', ...(departmentRows || []).filter(Boolean).sort()],
          },
        }),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Updates
  // ---------------------------------------------------------------------------

  async updateEventStatus(eventId: string, tenantId: string, status: EventStatus) {
    if (!Object.values(EventStatus).includes(status)) {
      throw new BadRequestException('Invalid event status');
    }
    const event = await this.eventModel.findOneAndUpdate(
      { _id: eventId, tenantId },
      { status },
      { new: true },
    );
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  async updateEventBanner(eventId: string, tenantId: string, bannerFile?: Express.Multer.File) {
    if (!bannerFile) throw new BadRequestException('No image file provided');
    const bannerUrl = await this.cloudinaryService.uploadImage(bannerFile, 'ticketr/events');
    const event = await this.eventModel.findOneAndUpdate(
      { _id: eventId, tenantId },
      { bannerUrl },
      { new: true },
    );
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  async updateEventImages(eventId: string, tenantId: string, files?: Express.Multer.File[]) {
    if (!files || files.length === 0) throw new BadRequestException('No image files provided');
    const uploadedUrls = await Promise.all(
      files.map((f) => this.cloudinaryService.uploadImage(f, 'ticketr/events')),
    );
    const event = await this.eventModel.findOne({ _id: eventId, tenantId });
    if (!event) throw new NotFoundException('Event not found');
    const updated = await this.eventModel.findOneAndUpdate(
      { _id: eventId, tenantId },
      {
        bannerUrl: event.bannerUrl || uploadedUrls[0],
        carouselImages: [...(event.carouselImages || []), ...uploadedUrls],
      },
      { new: true },
    );
    return updated;
  }

  async updateEventDetails(eventId: string, tenantId: string, body: any) {
    const event = await this.eventModel.findOne({ _id: eventId, tenantId });
    if (!event) throw new NotFoundException('Event not found');

    const updateData: any = {};
    if (body.title !== undefined) {
      if (String(body.title).trim().length < 3) throw new BadRequestException('Title is too short');
      updateData.title = String(body.title).trim();
    }
    if (body.description !== undefined) updateData.description = String(body.description).trim();
    if (body.location !== undefined) updateData.location = String(body.location).trim();
    if (body.isVirtual !== undefined) updateData.isVirtual = !!body.isVirtual;
    if (body.startDate !== undefined) {
      const start = new Date(body.startDate);
      if (isNaN(start.getTime())) throw new BadRequestException('Invalid start date');
      updateData.startDate = start;
    }
    if (body.endDate !== undefined) {
      const end = new Date(body.endDate);
      if (isNaN(end.getTime())) throw new BadRequestException('Invalid end date');
      updateData.endDate = end;
    }
    if (updateData.startDate && updateData.endDate && updateData.endDate <= updateData.startDate) {
      throw new BadRequestException('The event must end after it starts');
    }
    if (body.checkInStart !== undefined) {
      updateData.checkInStart = body.checkInStart ? new Date(body.checkInStart) : undefined;
    }
    if (body.checkInEnd !== undefined) {
      updateData.checkInEnd = body.checkInEnd ? new Date(body.checkInEnd) : undefined;
    }
    if (body.tags !== undefined) {
      updateData.tags = Array.isArray(body.tags)
        ? body.tags.map((t: string) => String(t).trim()).filter(Boolean)
        : String(body.tags).split(',').map((t) => t.trim()).filter(Boolean);
    }
    if (body.carouselImages !== undefined) updateData.carouselImages = body.carouselImages;
    if (body.galleryImages !== undefined) updateData.galleryImages = body.galleryImages;
    if (body.formSettings !== undefined) updateData.formSettings = body.formSettings;
    if (body.qrCodeDelivery !== undefined) updateData.qrCodeDelivery = body.qrCodeDelivery;
    if (body.resaleEnabled !== undefined) updateData.resaleEnabled = !!body.resaleEnabled;
    if (body.resalePriceCapPercent !== undefined) {
      const cap = Number(body.resalePriceCapPercent);
      if (!Number.isFinite(cap) || cap < 0 || cap > 100) {
        throw new BadRequestException('Resale price cap must be between 0 and 100%');
      }
      updateData.resalePriceCapPercent = cap;
    }
    if (body.transferPolicy !== undefined) updateData.transferPolicy = body.transferPolicy;
    if (body.refundPolicy !== undefined) updateData.refundPolicy = body.refundPolicy;
    if (body.venueMapUrl !== undefined) updateData.venueMapUrl = body.venueMapUrl;

    if (updateData.startDate || updateData.endDate) {
      const start = updateData.startDate || event.startDate;
      const end = updateData.endDate || event.endDate;
      if (end <= start) throw new BadRequestException('The event must end after it starts');
    }

    return this.eventModel.findByIdAndUpdate(event._id, { $set: updateData }, { new: true });
  }

  // ---------------------------------------------------------------------------
  // Tiers
  // ---------------------------------------------------------------------------

  async addTicketTier(eventId: string, tenantId: string, body: any) {
    const event = await this.eventModel.findOne({ _id: eventId, tenantId });
    if (!event) throw new NotFoundException('Event not found');

    const [validated] = this.validateTiers([body]);
    const tier = await this.ticketTierModel.create({ ...validated, eventId });
    await this.recalculateEventCapacity(event._id.toString());
    return this.tierView(tier);
  }

  async updateTicketTier(eventId: string, tierId: string, tenantId: string, body: any) {
    const event = await this.eventModel.findOne({ _id: eventId, tenantId });
    if (!event) throw new NotFoundException('Event not found');

    const tier = await this.ticketTierModel.findOne({ _id: tierId, eventId });
    if (!tier) throw new NotFoundException('Ticket tier not found');

    const updateData: any = {};
    if (body.name !== undefined) {
      if (String(body.name).trim().length < 2) throw new BadRequestException('Tier name is too short');
      updateData.name = String(body.name).trim();
    }
    if (body.description !== undefined) updateData.description = body.description;
    if (body.price !== undefined) {
      const price = Number(body.price);
      if (!Number.isFinite(price) || price < 0) throw new BadRequestException('Invalid price');
      if ((tier.soldCount || 0) > 0 && price !== tier.price) {
        throw new BadRequestException(
          'Ticket price cannot change after sales have started. Create a new tier instead.',
        );
      }
      updateData.price = price;
    }
    if (body.capacity !== undefined) {
      const capacity = Math.floor(Number(body.capacity));
      if (!Number.isFinite(capacity) || capacity < 1) {
        throw new BadRequestException('Capacity must be at least 1');
      }
      const committed = (tier.soldCount || 0) + (tier.reservedCount || 0);
      if (capacity < committed) {
        throw new BadRequestException(
          `Capacity cannot be lower than the ${committed} tickets already sold or held`,
        );
      }
      updateData.capacity = capacity;
    }
    if (body.maxPerPurchase !== undefined) {
      const max = Math.floor(Number(body.maxPerPurchase));
      if (!Number.isFinite(max) || max < 1) throw new BadRequestException('Invalid max per order');
      updateData.maxPerPurchase = max;
    }
    if (body.isActive !== undefined) updateData.isActive = !!body.isActive;
    if (body.markupFee !== undefined) updateData.markupFee = Number(body.markupFee) || 0;
    if (body.markupFeeType) updateData.markupFeeType = body.markupFeeType;
    if (body.markupStrategy) updateData.markupStrategy = body.markupStrategy;
    if (body.salesStartAt !== undefined) {
      updateData.salesStartAt = body.salesStartAt ? new Date(body.salesStartAt) : undefined;
    }
    if (body.salesEndAt !== undefined) {
      updateData.salesEndAt = body.salesEndAt ? new Date(body.salesEndAt) : undefined;
    }
    if (body.isCoupleTicket !== undefined) {
      if ((tier.soldCount || 0) > 0) {
        throw new BadRequestException('Ticket type cannot change after sales have started');
      }
      updateData.isCoupleTicket = !!body.isCoupleTicket;
    }

    const updated = await this.ticketTierModel.findByIdAndUpdate(tier._id, { $set: updateData }, { new: true });
    await this.recalculateEventCapacity(eventId);
    return this.tierView(updated as TicketTierDocument);
  }

  async updateTierBanner(
    eventId: string,
    tierId: string,
    tenantId: string,
    bannerFile?: Express.Multer.File,
  ) {
    const event = await this.eventModel.findOne({ _id: eventId, tenantId });
    if (!event) throw new NotFoundException('Event not found');
    if (!bannerFile) throw new BadRequestException('No image file provided');

    const templateImageUrl = await this.cloudinaryService.uploadImage(bannerFile, 'ticketr/tickets');
    const tier = await this.ticketTierModel.findOneAndUpdate(
      { _id: tierId, eventId },
      { templateImageUrl },
      { new: true },
    );
    if (!tier) throw new NotFoundException('Ticket tier not found');
    return tier;
  }

  async deleteTicketTier(eventId: string, tierId: string, tenantId: string) {
    const event = await this.eventModel.findOne({ _id: eventId, tenantId });
    if (!event) throw new NotFoundException('Event not found');
    const tier = await this.ticketTierModel.findOne({ _id: tierId, eventId });
    if (!tier) throw new NotFoundException('Ticket tier not found');
    if ((tier.soldCount || 0) > 0 || (tier.reservedCount || 0) > 0) {
      throw new BadRequestException('This tier has sold or held tickets and cannot be deleted');
    }
    await this.ticketTierModel.deleteOne({ _id: tier._id });
    await this.recalculateEventCapacity(eventId);
    return { success: true };
  }

  private async recalculateEventCapacity(eventId: string) {
    const tiers = await this.ticketTierModel.find({ eventId }).select('capacity').lean().exec();
    const capacity = tiers.reduce((sum, t: any) => sum + (t.capacity || 0), 0);
    await this.eventModel.updateOne({ _id: eventId }, { $set: { capacity } });
  }

  // ---------------------------------------------------------------------------
  // Delete / super admin
  // ---------------------------------------------------------------------------

  async deleteEvent(eventId: string, tenantId: string) {
    const event = await this.eventModel.findOne({ _id: eventId, tenantId });
    if (!event) throw new NotFoundException('Event not found');

    const ticketCount = await this.ticketModel.countDocuments({ eventId: event._id });
    const anyOrders = await this.orderModel.countDocuments({ eventId: event._id });

    if (ticketCount > 0 || anyOrders > 0) {
      throw new BadRequestException(
        'This event already has tickets or payments attached. Cancel it instead of deleting it so the financial record stays intact.',
      );
    }

    await this.ticketTierModel.deleteMany({ eventId: event._id });
    await this.orderModel.deleteMany({ eventId: event._id, status: { $in: [OrderStatus.PENDING, OrderStatus.FAILED, OrderStatus.CANCELLED] } });
    await this.eventModel.deleteOne({ _id: event._id });
    return { success: true };
  }

  async getAllEventsForSuperAdmin(page = 1, limit = 50) {
    page = Math.max(1, Number(page) || 1);
    limit = Math.min(200, Math.max(1, Number(limit) || 50));
    const [data, total] = await Promise.all([
      this.eventModel
        .find()
        .populate('tenantId', 'name slug status')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.eventModel.countDocuments(),
    ]);
    return { data, metadata: this.metadata(total, page, limit) };
  }
}
