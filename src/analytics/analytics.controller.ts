import { Controller, Get, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../schemas/user.schema';

@Controller('analytics')
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

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
