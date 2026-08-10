import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Event, EventDocument, EventStatus } from '../schemas/event.schema';
import { TicketTier, TicketTierDocument } from '../schemas/ticket-tier.schema';
import { Tenant, TenantDocument } from '../schemas/tenant.schema';
import { Ticket, TicketDocument } from '../schemas/ticket.schema';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

@Injectable()
export class EventService {
  constructor(
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    @InjectModel(TicketTier.name) private ticketTierModel: Model<TicketTierDocument>,
    @InjectModel(Tenant.name) private tenantModel: Model<TenantDocument>,
    @InjectModel(Ticket.name) private ticketModel: Model<TicketDocument>,
    private cloudinaryService: CloudinaryService,
  ) {}

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
      tags?: string[];
      tiers: Array<{
        name: string;
        description?: string;
        price: number;
        capacity: number;
        maxPerPurchase?: number;
      }>;
    },
    bannerFile?: Express.Multer.File,
  ) {
    let bannerUrl: string | undefined;
    if (bannerFile) {
      bannerUrl = await this.cloudinaryService.uploadImage(bannerFile, 'cmultickets/events');
    }

    const cleanSlug = dto.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const existing = await this.eventModel.findOne({ tenantId, slug: cleanSlug });
    if (existing) {
      throw new BadRequestException(`An event with slug '${cleanSlug}' already exists for this organization`);
    }

    const event = await this.eventModel.create({
      tenantId,
      title: dto.title,
      slug: cleanSlug,
      description: dto.description,
      location: dto.location,
      isVirtual: dto.isVirtual || false,
      startDate: dto.startDate,
      endDate: dto.endDate,
      tags: dto.tags || [],
      bannerUrl,
      createdBy: userId,
    });

    if (dto.tiers && dto.tiers.length > 0) {
      const tierDocs = dto.tiers.map((t) => ({
        eventId: event._id.toString(),
        name: t.name,
        description: t.description || '',
        price: t.price,
        capacity: t.capacity,
        maxPerPurchase: t.maxPerPurchase || 5,
      }));
      await this.ticketTierModel.insertMany(tierDocs);
    }

    return this.getEventWithTiers(event._id.toString());
  }

  async getEventsByTenantSlug(tenantSlug: string) {
    const tenant = await this.tenantModel.findOne({ slug: tenantSlug.toLowerCase() });
    if (!tenant) {
      throw new NotFoundException(`Tenant '${tenantSlug}' not found`);
    }
    const events = await this.eventModel
      .find({ tenantId: tenant._id.toString(), status: EventStatus.PUBLISHED })
      .sort({ startDate: 1 })
      .exec();

    const result = await Promise.all(
      events.map(async (ev) => {
        const tiers = await this.ticketTierModel.find({ eventId: ev._id.toString(), isActive: true }).exec();
        return {
          ...ev.toObject(),
          tiers,
        };
      }),
    );

    return {
      tenant: {
        id: tenant._id.toString(),
        name: tenant.name,
        slug: tenant.slug,
        logoUrl: tenant.logoUrl,
        primaryColor: tenant.primaryColor,
        secondaryColor: tenant.secondaryColor,
      },
      events: result,
    };
  }

  async getEventBySlug(tenantSlug: string, eventSlug: string) {
    const tenant = await this.tenantModel.findOne({ slug: tenantSlug.toLowerCase() });
    if (!tenant) {
      throw new NotFoundException(`Tenant '${tenantSlug}' not found`);
    }

    const event = await this.eventModel.findOne({
      tenantId: tenant._id.toString(),
      slug: eventSlug.toLowerCase(),
    });
    if (!event) {
      throw new NotFoundException(`Event '${eventSlug}' not found`);
    }

    const tiers = await this.ticketTierModel.find({ eventId: event._id.toString(), isActive: true }).exec();

    return {
      tenant: {
        id: tenant._id.toString(),
        name: tenant.name,
        slug: tenant.slug,
        logoUrl: tenant.logoUrl,
        primaryColor: tenant.primaryColor,
        secondaryColor: tenant.secondaryColor,
      },
      event: {
        ...event.toObject(),
        tiers,
      },
    };
  }

  async getEventWithTiers(eventId: string) {
    const event = await this.eventModel.findById(eventId);
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    const tiers = await this.ticketTierModel.find({ eventId }).exec();
    return {
      ...event.toObject(),
      tiers,
    };
  }

  async getTenantEventsForAdmin(tenantId: string) {
    const events = await this.eventModel.find({ tenantId }).sort({ createdAt: -1 }).exec();
    return Promise.all(
      events.map(async (ev) => {
        const tiers = await this.ticketTierModel.find({ eventId: ev._id.toString() }).exec();
        const totalCapacity = tiers.reduce((sum, t) => sum + t.capacity, 0);
        const totalSold = tiers.reduce((sum, t) => sum + t.soldCount, 0);
        return {
          ...ev.toObject(),
          totalCapacity,
          totalSold,
          tiers,
        };
      }),
    );
  }

  async getEventAttendees(eventId: string, tenantId: string) {
    const event = await this.eventModel.findOne({ _id: eventId, tenantId });
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const tickets = await this.ticketModel.find({ eventId }).populate('tierId').sort({ createdAt: -1 }).exec();

    return {
      event: {
        id: event._id.toString(),
        title: event.title,
        startDate: event.startDate,
        location: event.location,
      },
      attendees: tickets,
    };
  }

  async updateEventStatus(eventId: string, tenantId: string, status: EventStatus) {
    const event = await this.eventModel.findOneAndUpdate(
      { _id: eventId, tenantId },
      { status },
      { new: true },
    );
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  async deleteEvent(eventId: string, tenantId: string) {
    const result = await this.eventModel.deleteOne({ _id: eventId, tenantId });
    if (result.deletedCount === 0) {
      throw new NotFoundException('Event not found');
    }
    await this.ticketTierModel.deleteMany({ eventId });
    return { message: 'Event deleted successfully' };
  }

  async getAllEventsForSuperAdmin() {
    const events = await this.eventModel.find().populate('tenantId').sort({ createdAt: -1 }).exec();
    return events;
  }
}
