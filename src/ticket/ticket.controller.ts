import { Controller, Post, Get, Body, Param, UseGuards, Request, Res } from '@nestjs/common';
import type { Response } from 'express';
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
  async verifyScan(@Request() req, @Body('qrCodeHash') qrCodeHash: string, @Body('commit') commit?: boolean) {
    // If commit is not provided, default to true for backward compatibility
    const shouldCommit = commit !== undefined ? commit : true;
    return this.ticketService.verifyScan(qrCodeHash, req.user.userId, shouldCommit);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  @Get('event/:eventId')
  async getTicketsForEvent(@Param('eventId') eventId: string) {
    return this.ticketService.getTicketsForEvent(eventId);
  }

  @Get(':id/pdf')
  async downloadTicketPdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.ticketService.downloadTicketPdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="ticket-${id}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }

  @Get('lookup/:ticketNumber')
  async getTicketByNumber(@Param('ticketNumber') ticketNumber: string) {
    return this.ticketService.getTicketByNumber(ticketNumber);
  }
}
