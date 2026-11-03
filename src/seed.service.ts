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
    await this.seedSuperAdmin();
    await this.seedULSESAClient();
  }

  async seedSuperAdmin() {
    try {
      let superAdmin = await this.userModel.findOne({ email: 'markeyz.code@gmail.com' });
      if (!superAdmin) {
        const hashedPassword = await bcrypt.hash('SuperAdmin123!', 10);
        superAdmin = await this.userModel.create({
          name: 'Ticketr Super Admin',
          email: 'markeyz.code@gmail.com',
          passwordHash: hashedPassword,
          role: UserRole.SUPER_ADMIN,
        });
        this.logger.log('🔑 Seeded Super Admin: markeyz.code@gmail.com');
      }
    } catch (error) {
      this.logger.error('Error seeding Super Admin:', error);
    }
  }

  async seedULSESAClient() {
    try {
      // 1. Seed Tenant: Education (ULSESA)
      let tenant = await this.tenantModel.findOne({ slug: 'ulsesa' });
      if (!tenant) {
        tenant = await this.tenantModel.create({
          name: 'Education (ULSESA)',
          slug: 'ulsesa',
          customDomain: 'ulsesa.ticketr.org',
          primaryColor: '#D4AF37', // Gold / Amber Accent
          secondaryColor: '#0F172A',
          logoUrl: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87',
          contactEmail: 'admin@ulsesa.ticketr.org',
          contactPhone: '+2348012345678',
          status: TenantStatus.ACTIVE,
        });
        this.logger.log('🎉 Seeded Tenant: Education (ULSESA)');
      }

      // 2. Seed Organizer User
      let user = await this.userModel.findOne({ email: 'admin@ulsesa.ticketr.org' });
      if (!user) {
        const hashedPassword = await bcrypt.hash('Password123!', 10);
        user = await this.userModel.create({
          tenantId: tenant._id.toString(),
          name: 'ULSESA Executive Committee',
          email: 'admin@ulsesa.ticketr.org',
          passwordHash: hashedPassword,
          role: UserRole.ORGANIZER,
        });
        this.logger.log('👤 Seeded Organizer Account: admin@ulsesa.ticketr.org');
      }

      // 3. Seed Event: Dinner & Awards Night
      let event = await this.eventModel.findOne({ tenantId: tenant._id.toString(), slug: 'dinner-and-awards-night' });
      if (!event) {
        // Seeded events must be in the future or the storefront has nothing to sell.
        const eventDate = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000);
        eventDate.setHours(19, 0, 0, 0);
        const endDate = new Date(eventDate.getTime() + 7 * 60 * 60 * 1000);

        event = await this.eventModel.create({
          tenantId: tenant._id.toString(),
          slug: 'dinner-and-awards-night',
          title: 'Dinner & Awards Night',
          description: `THEME: LE GRAND SOIR: THE GRAND OVATION\n\nJoin us for an extravagant evening of glamour, recognition, and celebration.\n\n✨ Black Tie | Red Carpet | Awards | Live Entertainment\n\n📅 Date: ${eventDate.toDateString()}\n⏰ Red Carpet: 7:00 PM | Main Event: 8:00 PM\n📍 Venue: Undisclosed (Lagos)`,
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
          templateImageUrl: 'https://res.cloudinary.com/marquis/image/upload/v1786342609/avke8obpeqx39wcfioix.png',
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
          templateImageUrl: 'https://res.cloudinary.com/marquis/image/upload/v1786342611/idtlcrh9cqqav7rksnla.png',
        });

        // VVIP Ticket: ₦350,000 (Table of 10)
        const vvipTier = await this.ticketTierModel.create({
          eventId: event._id.toString(),
          name: 'VVIP (Table of 10)',
          price: 350000,
          capacity: 200,
          soldCount: 0,
          maxPerPurchase: 2,
          isActive: true,
          templateImageUrl: 'https://res.cloudinary.com/marquis/image/upload/v1786342600/kdyxsuz5dwo9xu0coj14.jpg',
        });

        this.logger.log('🎟️ Seeded Ticket Tiers for ULSESA: Regular (₦15k), VIP (₦25k), VVIP Table of 10 (₦350k)');
      }
    } catch (error) {
      this.logger.error('Error seeding ULSESA client database:', error);
    }
  }
}
