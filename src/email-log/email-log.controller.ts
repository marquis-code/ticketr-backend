import { Controller, Get, Post, Param, Query, UseGuards } from '@nestjs/common';
import { EmailLogService } from './email-log.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../schemas/user.schema';

@Controller('email-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmailLogController {
  constructor(private readonly emailLogService: EmailLogService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN)
  async getLogs(@Query('page') page: string = '1', @Query('limit') limit: string = '20') {
    return this.emailLogService.getLogs(parseInt(page), parseInt(limit));
  }

  @Post(':id/retry')
  @Roles(UserRole.SUPER_ADMIN)
  async retryEmail(@Param('id') id: string) {
    const log = await this.emailLogService.retryEmail(id);
    return { success: true, log };
  }
}
