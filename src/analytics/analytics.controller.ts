import { Controller, Get, Post, Body, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('track-visit')
  async trackVisit(@Body() body: { tenantId?: string; page?: string; details?: any }, @Request() req) {
    if (!body?.tenantId) return { success: true };

    // Only resolve to a real, existing tenant. Never trust an arbitrary id.
    let tenantId: string | null = null;
    if (/^[0-9a-fA-F]{24}$/.test(body.tenantId)) {
      tenantId = body.tenantId;
    } else {
      tenantId = await this.analyticsService.resolveTenantIdFromSubdomain(body.tenantId);
    }
    if (!tenantId) return { success: true };

    try {
      await this.auditService.logAction({
        action: 'PUBLIC_PAGE_VISIT',
        entity: 'Storefront',
        entityId: 'N/A',
        userId: undefined as any,
        tenantId,
        details: {
          page: String(body.page || '/').slice(0, 200),
          referrer: String(req.headers['referer'] || '').slice(0, 300),
          userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
        },
        ipAddress: req.ip,
      });
    } catch {
      // Analytics must never break the storefront.
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
