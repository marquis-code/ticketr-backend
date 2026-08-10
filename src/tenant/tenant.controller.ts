import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../schemas/user.schema';
import { TenantStatus } from '../schemas/tenant.schema';

@Controller('tenants')
export class TenantController {
  constructor(private tenantService: TenantService) {}

  @Get('slug/:slug')
  async getBySlug(@Param('slug') slug: string) {
    return this.tenantService.getTenantBySlug(slug);
  }

  @Get('domain/:domain')
  async getByDomain(@Param('domain') domain: string) {
    return this.tenantService.getTenantByDomain(domain);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Get()
  async getAllTenants() {
    return this.tenantService.getAllTenants();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Post()
  async createTenant(@Body() body: any) {
    return this.tenantService.createTenant(body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORGANIZER)
  @Patch(':id')
  async updateTenant(@Param('id') id: string, @Body() body: any) {
    return this.tenantService.updateTenant(id, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Patch(':id/status')
  async updateStatus(@Param('id') id: string, @Body('status') status: TenantStatus) {
    return this.tenantService.updateStatus(id, status);
  }
}
