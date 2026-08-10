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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../schemas/user.schema';
import { EventStatus } from '../schemas/event.schema';

@Controller('events')
export class EventController {
  constructor(private eventService: EventService) {}

  @Get('tenant/:tenantSlug')
  async getTenantEvents(@Param('tenantSlug') tenantSlug: string) {
    return this.eventService.getEventsByTenantSlug(tenantSlug);
  }

  @Get('tenant/:tenantSlug/:eventSlug')
  async getSingleEvent(@Param('tenantSlug') tenantSlug: string, @Param('eventSlug') eventSlug: string) {
    return this.eventService.getEventBySlug(tenantSlug, eventSlug);
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
    return this.eventService.updateEventStatus(eventId, req.user.tenantId, status);
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
  @Roles(UserRole.SUPER_ADMIN)
  @Get('superadmin/all')
  async getAllEventsSuperAdmin() {
    return this.eventService.getAllEventsForSuperAdmin();
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
        tags: body.tags ? (typeof body.tags === 'string' ? body.tags.split(',') : body.tags) : [],
        tiers: parsedTiers,
      },
      file,
    );
  }
}
