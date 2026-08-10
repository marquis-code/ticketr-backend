import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Tenant, TenantDocument, TenantStatus } from '../schemas/tenant.schema';

@Injectable()
export class TenantService {
  constructor(@InjectModel(Tenant.name) private tenantModel: Model<TenantDocument>) {}

  async createTenant(data: Partial<Tenant>) {
    if (!data.slug) {
      throw new BadRequestException('Tenant slug is required');
    }
    const cleanSlug = data.slug.toLowerCase();
    const existing = await this.tenantModel.findOne({ slug: cleanSlug });
    if (existing) {
      throw new BadRequestException('Tenant slug already taken');
    }
    return this.tenantModel.create({
      ...data,
      slug: cleanSlug,
    });
  }

  async getTenantBySlug(slug: string) {
    const tenant = await this.tenantModel.findOne({ slug: slug.toLowerCase() });
    if (!tenant) {
      throw new NotFoundException(`Organization tenant '${slug}' not found`);
    }
    return tenant;
  }

  async getTenantByDomain(domain: string) {
    const tenant = await this.tenantModel.findOne({
      $or: [{ customDomain: domain.toLowerCase() }, { slug: domain.toLowerCase() }],
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant with domain '${domain}' not found`);
    }
    return tenant;
  }

  async getAllTenants() {
    return this.tenantModel.find().exec();
  }

  async updateTenant(id: string, updates: Partial<Tenant>) {
    const tenant = await this.tenantModel.findByIdAndUpdate(id, updates, { new: true });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return tenant;
  }

  async updateStatus(id: string, status: TenantStatus) {
    return this.updateTenant(id, { status });
  }
}
