import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  Res,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { TicketService } from './ticket.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../schemas/user.schema';

@Controller('tickets')
export class TicketController {
  constructor(private ticketService: TicketService) {}

  // ---------------------------------------------------------------------------
  // Gate scanning
  // ---------------------------------------------------------------------------

  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.STAFF, UserRole.SUPER_ADMIN)
  @Post('verify-scan')
  async verifyScan(
    @Request() req,
    @Body('qrCodeHash') qrCodeHash: string,
    @Body('eventId') eventId?: string,
    @Body('commit') commit?: boolean,
  ) {
    return this.ticketService.verifyScan(
      qrCodeHash,
      {
        userId: req.user.userId,
        role: req.user.role,
        tenantId: req.user.tenantId,
        eventId,
      },
      commit !== undefined ? commit : true,
    );
  }

  // ---------------------------------------------------------------------------
  // Organizer views
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  @Get('event/:eventId')
  async getTicketsForEvent(@Request() req, @Param('eventId') eventId: string) {
    if (!req.user.tenantId) throw new BadRequestException('User must belong to an organization');
    return this.ticketService.getTicketsForEvent(eventId, req.user.tenantId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  @Get('lookup/:ticketNumber')
  async getTicketByNumber(@Request() req, @Param('ticketNumber') ticketNumber: string) {
    if (!req.user.tenantId) throw new BadRequestException('User must belong to an organization');
    return this.ticketService.getTicketByNumber(ticketNumber, req.user.tenantId);
  }

  // ---------------------------------------------------------------------------
  // Ticket documents — require the private wallet token
  // ---------------------------------------------------------------------------

  @Get(':id/pdf')
  async downloadTicketPdf(
    @Param('id') id: string,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    if (!token) throw new BadRequestException('A private wallet token is required');
    const buffer = await this.ticketService.downloadTicketPdf(id, { walletToken: token });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="ticket-${id}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }

  // ---------------------------------------------------------------------------
  // Transfers / claims — wallet-token possession is the authorisation
  // ---------------------------------------------------------------------------

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/transfer')
  async transferTicket(
    @Param('id') ticketId: string,
    @Body()
    body: {
      walletToken?: string;
      newAttendeeName: string;
      newAttendeeEmail: string;
    },
  ) {
    if (!body?.walletToken) {
      throw new BadRequestException('Your private wallet token is required to transfer a ticket');
    }
    return this.ticketService.transferTicket(
      ticketId,
      { walletToken: body.walletToken },
      body.newAttendeeName,
      body.newAttendeeEmail,
    );
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/claim')
  async claimGroupTicket(
    @Param('id') ticketId: string,
    @Body()
    body: {
      walletToken?: string;
      attendeeName: string;
      attendeeEmail: string;
    },
  ) {
    if (!body?.walletToken) {
      throw new BadRequestException('Your private wallet token is required to claim a ticket');
    }
    return this.ticketService.claimGroupTicket(
      ticketId,
      { walletToken: body.walletToken },
      body.attendeeName,
      body.attendeeEmail,
    );
  }

  // ---------------------------------------------------------------------------
  // Organizer ticket operations
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN, UserRole.STAFF)
  @Post(':id/resend-email')
  async resendTicketEmail(
    @Request() req,
    @Param('id') ticketId: string,
    @Body() body: { newEmail?: string },
  ) {
    if (!req.user.tenantId) throw new BadRequestException('User must belong to an organization');
    return this.ticketService.resendTicketEmail(ticketId, req.user.tenantId, body?.newEmail);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  @Post(':id/change-tier')
  async changeTicketTier(
    @Request() req,
    @Param('id') ticketId: string,
    @Body() body: { newTierId: string },
  ) {
    if (!req.user.tenantId) throw new BadRequestException('User must belong to an organization');
    if (!body?.newTierId) throw new BadRequestException('newTierId is required');
    return this.ticketService.changeTicketTier(
      ticketId,
      body.newTierId,
      req.user.tenantId,
      req.user.userId,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  @Post('admin/:id/transfer')
  async organizerTransfer(
    @Request() req,
    @Param('id') ticketId: string,
    @Body() body: { newAttendeeName: string; newAttendeeEmail: string },
  ) {
    if (!req.user.tenantId) throw new BadRequestException('User must belong to an organization');
    return this.ticketService.transferTicket(
      ticketId,
      { tenantId: req.user.tenantId, userId: req.user.userId, role: req.user.role },
      body.newAttendeeName,
      body.newAttendeeEmail,
    );
  }

  // ---------------------------------------------------------------------------
  // Verified resale marketplace
  // ---------------------------------------------------------------------------

  @Get('resale/event/:eventId')
  async getResaleListings(@Param('eventId') eventId: string) {
    return this.ticketService.getResaleListings(eventId);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/resale')
  async createResaleListing(
    @Param('id') ticketId: string,
    @Body() body: { walletToken?: string; askingPrice: number },
  ) {
    if (!body?.walletToken) {
      throw new BadRequestException('Your private wallet token is required to list a ticket');
    }
    return this.ticketService.createResaleListing(ticketId, { walletToken: body.walletToken }, body.askingPrice);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('resale/:listingId/checkout')
  async resaleCheckout(
    @Param('listingId') listingId: string,
    @Body()
    body: { buyerName: string; buyerEmail: string; callbackUrl: string },
  ) {
    if (!body?.callbackUrl) throw new BadRequestException('callbackUrl is required');
    return this.ticketService.initializeResaleCheckout(
      listingId,
      body.buyerName,
      body.buyerEmail,
      body.callbackUrl,
    );
  }

  @Get('resale/verify')
  async verifyResale(@Query('reference') reference: string) {
    if (!reference) throw new BadRequestException('reference is required');
    return this.ticketService.verifyResalePayment(reference);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('resale/:listingId/cancel')
  async cancelResale(
    @Param('listingId') listingId: string,
    @Body() body: { walletToken?: string },
  ) {
    if (!body?.walletToken) {
      throw new BadRequestException('Your private wallet token is required');
    }
    return this.ticketService.cancelResaleListing(listingId, { walletToken: body.walletToken });
  }
}
