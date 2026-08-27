import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { CommunicationsService } from './communications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../schemas/user.schema';

@Controller('communications')
export class CommunicationsController {
  constructor(private readonly commsService: CommunicationsService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  @Post('broadcast')
  async broadcast(@Request() req, @Body() body: any) {
    return this.commsService.broadcastEmail({
      tenantId: req.user.tenantId,
      ...body
    });
  }
}
