import { Controller, Get, Post, Body, Query, UseGuards, Req } from '@nestjs/common';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../schemas/user.schema';

@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  async getTenantLogs(
    @Req() req: any,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('entity') entity?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 50;
    
    // Fallback to super admin query logic if needed in the future, for now it filters by req.user.tenantId
    const tenantId = req.user.tenantId; 
    
    return this.auditService.getLogsForTenant(tenantId, pageNum, limitNum, {
      userId, action, entity, startDate, endDate
    });
  }

  @Post('client')
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  async logClientEvent(
    @Req() req: any,
    @Body() body: { action: string; entity: string; details: any }
  ) {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;
    
    await this.auditService.logAction({
      action: body.action || 'CLIENT_INTERACTION',
      entity: body.entity || 'Frontend UI',
      entityId: 'N/A',
      userId,
      tenantId,
      details: body.details,
      ipAddress: req.ip,
    });
    
    return { success: true };
  }
}
