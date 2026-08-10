import { Controller, Post, Get, Body, Param, UseGuards, Request } from '@nestjs/common';
import { TicketService } from './ticket.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../schemas/user.schema';

@Controller('tickets')
export class TicketController {
  constructor(private ticketService: TicketService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.STAFF, UserRole.SUPER_ADMIN)
  @Post('verify-scan')
  async verifyScan(@Request() req, @Body('qrCodeHash') qrCodeHash: string) {
    return this.ticketService.verifyScan(qrCodeHash, req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  @Get('event/:eventId')
  async getTicketsForEvent(@Param('eventId') eventId: string) {
    return this.ticketService.getTicketsForEvent(eventId);
  }

  @Get('lookup/:ticketNumber')
  async getTicketByNumber(@Param('ticketNumber') ticketNumber: string) {
    return this.ticketService.getTicketByNumber(ticketNumber);
  }
}
