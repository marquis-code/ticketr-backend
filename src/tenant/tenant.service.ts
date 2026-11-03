import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Tenant, TenantDocument, TenantStatus } from '../schemas/tenant.schema';
import { User, UserDocument, UserRole } from '../schemas/user.schema';
import * as bcrypt from 'bcrypt';

@Injectable()
export class TenantService {
  constructor(
    @InjectModel(Tenant.name) private tenantModel: Model<TenantDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  async createTenant(
    data: Partial<Tenant> & {
      ownerName?: string;
      ownerEmail?: string;
      ownerPassword?: string;
    },
  ) {
    if (!data.slug || !data.name || !data.contactEmail) {
      throw new BadRequestException('Name, slug and contact email are required');
    }
    const cleanSlug = data.slug
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    if (cleanSlug.length < 3) {
      throw new BadRequestException('Slug must be at least 3 characters');
    }
    const existing = await this.tenantModel.findOne({ slug: cleanSlug });
    if (existing) {
      throw new BadRequestException('Tenant slug already taken');
    }
    if (data.ownerEmail) {
      const email = data.ownerEmail.toLowerCase().trim();
      const existingUser = await this.userModel.findOne({ email });
      if (existingUser) {
        throw new BadRequestException('An account with the owner email already exists');
      }
    }

    const tenant = await this.tenantModel.create({
      name: data.name,
      slug: cleanSlug,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone,
      logoUrl: data.logoUrl,
      primaryColor: data.primaryColor,
      secondaryColor: data.secondaryColor,
      status: data.status || TenantStatus.ACTIVE,
      paymentMethod: data.paymentMethod,
      primaryRemittanceAccount: data.primaryRemittanceAccount,
      notificationEmails: data.notificationEmails || [],
    });

    // A tenant without an owner cannot sign in. Create the organizer account in
    // the same operation so onboarding is actually usable.
    if (data.ownerEmail && data.ownerPassword) {
      if (data.ownerPassword.length < 8) {
        await this.tenantModel.deleteOne({ _id: tenant._id });
        throw new BadRequestException('Owner password must be at least 8 characters');
      }
      try {
        await this.userModel.create({
          name: (data.ownerName || data.name).trim(),
          email: data.ownerEmail.toLowerCase().trim(),
          passwordHash: await bcrypt.hash(data.ownerPassword, 12),
          role: UserRole.ORGANIZER,
          tenantId: tenant._id.toString(),
        });
      } catch (err) {
        await this.tenantModel.deleteOne({ _id: tenant._id });
        throw new BadRequestException('Could not create the owner account');
      }
    }

    return tenant;
  }

  /** Public projection — never exposes payout accounts or internal emails. */
  private toPublicTenant(tenant: TenantDocument) {
    return {
      id: tenant._id.toString(),
      name: tenant.name,
      slug: tenant.slug,
      logoUrl: tenant.logoUrl,
      primaryColor: tenant.primaryColor,
      secondaryColor: tenant.secondaryColor,
      status: tenant.status,
      contactEmail: tenant.contactEmail,
    };
  }

  async getTenantBySlug(slug: string) {
    const tenant = await this.tenantModel.findOne({ slug: slug.toLowerCase() });
    if (!tenant) {
      throw new NotFoundException(`Organization tenant '${slug}' not found`);
    }
    return this.toPublicTenant(tenant);
  }

  async getTenantByDomain(domain: string) {
    const tenant = await this.tenantModel.findOne({
      $or: [{ customDomain: domain.toLowerCase() }, { slug: domain.toLowerCase() }],
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant with domain '${domain}' not found`);
    }
    return this.toPublicTenant(tenant);
  }

  async getAllTenants() {
    return this.tenantModel.find().exec();
  }

  async updateTenant(
    id: string,
    updates: Partial<Tenant>,
    actor: { role: string; tenantId?: string },
  ) {
    if (actor.role !== 'SUPER_ADMIN') {
      // An organizer may only ever edit its own organization.
      if (!actor.tenantId || actor.tenantId.toString() !== id.toString()) {
        throw new ForbiddenException('You can only edit your own organization');
      }
    }

    const allowedForOrganizer = [
      'name',
      'logoUrl',
      'primaryColor',
      'secondaryColor',
      'contactEmail',
      'contactPhone',
      'notificationEmails',
      'primaryRemittanceAccount',
      'remittanceAccount',
      'secondaryRemittanceAccount',
    ];
    const allowedForSuperAdmin = [
      ...allowedForOrganizer,
      'slug',
      'customDomain',
      'status',
      'paymentMethod',
      'paystackSubaccountCode',
    ];
    const allowed = actor.role === 'SUPER_ADMIN' ? allowedForSuperAdmin : allowedForOrganizer;

    const safe: any = {};
    for (const key of allowed) {
      if ((updates as any)[key] !== undefined) safe[key] = (updates as any)[key];
    }

    if (safe.slug) {
      const cleanSlug = String(safe.slug)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      if (cleanSlug.length < 3) throw new BadRequestException('Slug is too short');
      const existing = await this.tenantModel.findOne({ slug: cleanSlug, _id: { $ne: id } });
      if (existing) throw new BadRequestException('Tenant subdomain already taken');
      safe.slug = cleanSlug;
    }

    if (safe.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(safe.contactEmail)) {
      throw new BadRequestException('Please provide a valid contact email');
    }

    if (safe.primaryRemittanceAccount) {
      const account = safe.primaryRemittanceAccount;
      if (account.accountNumber && !/^\d{6,20}$/.test(String(account.accountNumber))) {
        throw new BadRequestException('Account number must be 6–20 digits');
      }
    }

    const tenant = await this.tenantModel.findByIdAndUpdate(id, { $set: safe }, { new: true });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async updateStatus(id: string, status: TenantStatus) {
    if (!Object.values(TenantStatus).includes(status)) {
      throw new BadRequestException('Invalid tenant status');
    }
    const tenant = await this.tenantModel.findByIdAndUpdate(id, { $set: { status } }, { new: true });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }
}
