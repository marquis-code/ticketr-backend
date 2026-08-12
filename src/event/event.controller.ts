import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { EventService } from './event.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../schemas/user.schema';
import { EventStatus } from '../schemas/event.schema';

@Controller('events')
export class EventController {
  constructor(
    private eventService: EventService,
    private auditService: AuditService
  ) {}

  @Get('public/all')
  async getAllPublicEvents() {
    return this.eventService.getAllPublicEvents();
  }

  @Get('tenant/:tenantSlug')
  async getTenantEvents(@Param('tenantSlug') tenantSlug: string) {
    return this.eventService.getEventsByTenantSlug(tenantSlug);
  }

  @Get('tenant/:tenantSlug/:eventSlug')
  async getSingleEvent(@Param('tenantSlug') tenantSlug: string, @Param('eventSlug') eventSlug: string) {
    return this.eventService.getEventBySlug(tenantSlug, eventSlug);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Get('superadmin/all')
  async getAllEventsSuperAdmin() {
    return this.eventService.getAllEventsForSuperAdmin();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Get('admin/my-events')
  async getMyEvents(@Request() req) {
    if (!req.user.tenantId) {
      throw new BadRequestException('User is not associated with any organization tenant');
    }
    return this.eventService.getTenantEventsForAdmin(req.user.tenantId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Get(':id/attendees')
  async getEventAttendees(@Request() req, @Param('id') eventId: string) {
    if (!req.user.tenantId) {
      throw new BadRequestException('User must belong to an organization');
    }
    return this.eventService.getEventAttendees(eventId, req.user.tenantId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Patch(':id/status')
  async updateStatus(@Request() req, @Param('id') eventId: string, @Body('status') status: EventStatus) {
    if (!req.user.tenantId) {
      throw new BadRequestException('User must belong to an organization');
    }
    const result = await this.eventService.updateEventStatus(eventId, req.user.tenantId, status);
    
    await this.auditService.logAction({
      action: 'EVENT_STATUS_UPDATED',
      entity: 'Event',
      entityId: eventId,
      userId: req.user.userId,
      tenantId: req.user.tenantId,
      details: { status }
    });

    return result;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Patch(':id')
  @UseInterceptors(FileInterceptor('banner'))
  async updateEventBanner(
    @Request() req,
    @Param('id') eventId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!req.user.tenantId) {
      throw new BadRequestException('User must belong to an organization');
    }
    return this.eventService.updateEventBanner(eventId, req.user.tenantId, file);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Patch(':id/details')
  async updateEventDetails(
    @Request() req,
    @Param('id') eventId: string,
    @Body() body: any,
  ) {
    if (!req.user.tenantId) {
      throw new BadRequestException('User must belong to an organization');
    }
    const result = await this.eventService.updateEventDetails(eventId, req.user.tenantId, body);
    
    await this.auditService.logAction({
      action: 'EVENT_DETAILS_UPDATED',
      entity: 'Event',
      entityId: eventId,
      userId: req.user.userId,
      tenantId: req.user.tenantId,
      details: body
    });

    return result;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Post(':id/tiers')
  async addTicketTier(
    @Request() req,
    @Param('id') eventId: string,
    @Body() body: any,
  ) {
    if (!req.user.tenantId) {
      throw new BadRequestException('User must belong to an organization');
    }
    return this.eventService.addTicketTier(eventId, req.user.tenantId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Patch(':id/tiers/:tierId')
  async updateTicketTier(
    @Request() req,
    @Param('id') eventId: string,
    @Param('tierId') tierId: string,
    @Body() body: any,
  ) {
    if (!req.user.tenantId) {
      throw new BadRequestException('User must belong to an organization');
    }
    return this.eventService.updateTicketTier(eventId, tierId, req.user.tenantId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Patch(':id/tiers/:tierId/banner')
  @UseInterceptors(FileInterceptor('banner'))
  async updateTierBanner(
    @Request() req,
    @Param('id') eventId: string,
    @Param('tierId') tierId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!req.user.tenantId) {
      throw new BadRequestException('User must belong to an organization');
    }
    return this.eventService.updateTierBanner(eventId, tierId, req.user.tenantId, file);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Delete(':id')
  async deleteEvent(@Request() req, @Param('id') eventId: string) {
    if (!req.user.tenantId) {
      throw new BadRequestException('User must belong to an organization');
    }
    return this.eventService.deleteEvent(eventId, req.user.tenantId);
  }



  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Post()
  @UseInterceptors(FileInterceptor('banner'))
  async createEvent(
    @Request() req,
    @Body() body: any,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!req.user.tenantId) {
      throw new BadRequestException('User must belong to an organization to create events');
    }

    let parsedTiers = [];
    if (typeof body.tiers === 'string') {
      try {
        parsedTiers = JSON.parse(body.tiers);
      } catch (e) {
        parsedTiers = [];
      }
    } else if (Array.isArray(body.tiers)) {
      parsedTiers = body.tiers;
    }

    return this.eventService.createEvent(
      req.user.userId,
      req.user.tenantId,
      {
        title: body.title,
        slug: body.slug,
        description: body.description,
        location: body.location,
        isVirtual: body.isVirtual === 'true' || body.isVirtual === true,
        startDate: new Date(body.startDate),
        endDate: new Date(body.endDate),
        checkInStart: body.checkInStart ? new Date(body.checkInStart) : undefined,
        checkInEnd: body.checkInEnd ? new Date(body.checkInEnd) : undefined,
        tags: body.tags ? (typeof body.tags === 'string' ? body.tags.split(',') : body.tags) : [],
        carouselImages: body.carouselImages ? (typeof body.carouselImages === 'string' ? JSON.parse(body.carouselImages) : body.carouselImages) : [],
        tiers: parsedTiers,
      },
      file,
    );
  }
}
