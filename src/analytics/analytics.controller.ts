import { Controller, Get, Post, Body, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../schemas/user.schema';

@Controller('analytics')
export class AnalyticsController {
  constructor(
    private analyticsService: AnalyticsService,
    private auditService: AuditService
  ) {}

  @Post('track-visit')
  async trackVisit(@Body() body: { tenantId: string; page: string; details: any }, @Request() req) {
    if (body.tenantId) {
      let realTenantId = body.tenantId;
      if (!body.tenantId.match(/^[0-9a-fA-F]{24}$/)) {
        realTenantId = await this.analyticsService.resolveTenantIdFromSubdomain(body.tenantId) || body.tenantId;
      }
      
      try {
        await this.auditService.logAction({
          action: 'PUBLIC_SUBDOMAIN_VISITED',
          entity: 'Subdomain',
          entityId: 'N/A',
          userId: '000000000000000000000000', // Anonymous System ID
          tenantId: realTenantId,
          details: {
            page: body.page,
            userAgent: req.headers['user-agent'],
            ...body.details
          },
          ipAddress: req.ip,
        });
      } catch (e) {}
    }
    return { success: true };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Get('tenant')
  async getTenantAnalytics(@Request() req) {
    if (!req.user.tenantId) {
      throw new BadRequestException('User is not associated with a tenant');
    }
    return this.analyticsService.getTenantAnalytics(req.user.tenantId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Get('superadmin')
  async getSuperAdminAnalytics() {
    return this.analyticsService.getSuperAdminAnalytics();
  }
}
