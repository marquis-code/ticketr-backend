import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { PayoutService } from './payout.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../schemas/user.schema';
import { PayoutStatus } from '../schemas/payout.schema';
import { AuditService } from '../audit/audit.service';

@Controller('payouts')
export class PayoutController {
  constructor(
    private readonly payoutService: PayoutService,
    private readonly auditService: AuditService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Get('tenant/summary')
  async summary(@Request() req) {
    return this.payoutService.getSummary(req.user.tenantId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Get('tenant')
  async tenantPayouts(
    @Request() req,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.payoutService.listForTenant(
      req.user.tenantId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Post('request')
  async requestPayout(@Request() req) {
    const result = await this.payoutService.requestPayout(req.user.tenantId, req.user.userId);
    await this.auditService.logAction({
      action: 'PAYOUT_REQUESTED',
      entity: 'Payout',
      entityId: result._id.toString(),
      userId: req.user.userId,
      tenantId: req.user.tenantId,
      details: { amount: result.amount, orders: result.orderCount },
    });
    return result;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Patch(':id/cancel')
  async cancelPayout(@Request() req, @Param('id') id: string) {
    return this.payoutService.updateStatus(
      id,
      PayoutStatus.CANCELLED,
      { userId: req.user.userId, role: req.user.role, tenantId: req.user.tenantId },
      { note: 'Cancelled by organizer' },
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Get('platform/summary')
  async platformSummary() {
    return this.payoutService.getPlatformSummary();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Get('all')
  async all(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.payoutService.listAll(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
      status,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Patch(':id/status')
  async updateStatus(
    @Request() req,
    @Param('id') id: string,
    @Body('status') status: PayoutStatus,
    @Body('reference') reference?: string,
    @Body('note') note?: string,
    @Body('failureReason') failureReason?: string,
  ) {
    const result = await this.payoutService.updateStatus(
      id,
      status,
      { userId: req.user.userId, role: req.user.role, tenantId: req.user.tenantId },
      { reference, note, failureReason },
    );
    await this.auditService.logAction({
      action: `PAYOUT_${status}`,
      entity: 'Payout',
      entityId: id,
      userId: req.user.userId,
      tenantId: result.tenantId?.toString(),
      details: { reference, note, failureReason },
    });
    return result;
  }
}
