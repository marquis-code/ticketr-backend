import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Tenant, TenantDocument, TenantStatus } from './schemas/tenant.schema';
import { User, UserDocument, UserRole } from './schemas/user.schema';
import { Event, EventDocument, EventStatus } from './schemas/event.schema';
import { TicketTier, TicketTierDocument } from './schemas/ticket-tier.schema';
import * as bcrypt from 'bcrypt';

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectModel(Tenant.name) private tenantModel: Model<TenantDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    @InjectModel(TicketTier.name) private ticketTierModel: Model<TicketTierDocument>,
  ) {}

  async onModuleInit() {
    await this.seedULSESAClient();
  }

  async seedULSESAClient() {
    try {
      // 1. Seed Tenant: Education (ULSESA)
      let tenant = await this.tenantModel.findOne({ slug: 'ulsesa' });
      if (!tenant) {
        tenant = await this.tenantModel.create({
          name: 'Education (ULSESA)',
          slug: 'ulsesa',
          customDomain: 'ulsesa.cmultickets.com',
          primaryColor: '#D4AF37', // Gold / Amber Accent
          secondaryColor: '#0F172A',
          logoUrl: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87',
          contactEmail: 'admin@ulsesa.cmultickets.com',
          contactPhone: '+2348012345678',
          status: TenantStatus.ACTIVE,
        });
        this.logger.log('🎉 Seeded Tenant: Education (ULSESA)');
      }

      // 2. Seed Organizer User
      let user = await this.userModel.findOne({ email: 'admin@ulsesa.cmultickets.com' });
      if (!user) {
        const hashedPassword = await bcrypt.hash('Password123!', 10);
        user = await this.userModel.create({
          tenantId: tenant._id.toString(),
          name: 'ULSESA Executive Committee',
          email: 'admin@ulsesa.cmultickets.com',
          passwordHash: hashedPassword,
          role: UserRole.ORGANIZER,
        });
        this.logger.log('👤 Seeded Organizer Account: admin@ulsesa.cmultickets.com');
      }

      // 3. Seed Event: Dinner & Awards Night
      let event = await this.eventModel.findOne({ tenantId: tenant._id.toString(), slug: 'dinner-and-awards-night' });
      if (!event) {
        const eventDate = new Date('2026-09-06T19:00:00.000Z'); // Sunday, Sept. 6th, 2026
        const endDate = new Date('2026-09-07T02:00:00.000Z');

        event = await this.eventModel.create({
          tenantId: tenant._id.toString(),
          slug: 'dinner-and-awards-night',
          title: 'Dinner & Awards Night',
          description: `THEME: LE GRAND SOIR: THE GRAND OVATION\n\nJoin us for an extravagant evening of glamour, recognition, and celebration.\n\n✨ Black Tie | Red Carpet | Awards | Live Entertainment\n\n📅 Date: Sunday, Sept. 6th, 2026\n⏰ Red Carpet: 7:00 PM | Main Event: 8:00 PM\n📍 Venue: Undisclosed (Lagos)`,
          bannerUrl: 'https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=1200&q=80',
          startDate: eventDate,
          endDate: endDate,
          location: 'Undisclosed (Lagos)',
          isVirtual: false,
          status: EventStatus.PUBLISHED,
          createdBy: user._id.toString(),
        });
        this.logger.log('🎪 Seeded Event: Dinner & Awards Night');

        // 4. Seed Ticket Tiers for ULSESA Event
        // Regular Ticket: ₦15,000
        const regularTier = await this.ticketTierModel.create({
          eventId: event._id.toString(),
          name: 'Regular',
          price: 15000,
          capacity: 300,
          soldCount: 0,
          maxPerPurchase: 5,
          isActive: true,
        });

        // VIP Ticket: ₦25,000
        const vipTier = await this.ticketTierModel.create({
          eventId: event._id.toString(),
          name: 'VIP',
          price: 25000,
          capacity: 100,
          soldCount: 0,
          maxPerPurchase: 5,
          isActive: true,
        });

        // VVIP Ticket: ₦350,000 (Table of 10)
        const vvipTier = await this.ticketTierModel.create({
          eventId: event._id.toString(),
          name: 'VVIP (Table of 10)',
          price: 350000,
          capacity: 20,
          soldCount: 0,
          maxPerPurchase: 2,
          isActive: true,
        });

        this.logger.log('🎟️ Seeded Ticket Tiers for ULSESA: Regular (₦15k), VIP (₦25k), VVIP Table of 10 (₦350k)');
      }
    } catch (error) {
      this.logger.error('Error seeding ULSESA client database:', error);
    }
  }
}
