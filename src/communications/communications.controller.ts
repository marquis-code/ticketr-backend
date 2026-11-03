import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, Request, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CommunicationsService } from './communications.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../schemas/user.schema';

@Controller('communications')
export class CommunicationsController {
  constructor(
    private readonly commsService: CommunicationsService,
    private readonly cloudinaryService: CloudinaryService
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  @Get()
  async findAll(@Request() req, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.commsService.findAll(
      req.user.tenantId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  @Get(':id/preview-recipients')
  async previewRecipients(@Request() req, @Param('id') id: string) {
    return this.commsService.previewRecipients(id, req.user.tenantId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  @Get(':id')
  async findOne(@Request() req, @Param('id') id: string) {
    return this.commsService.findOne(id, req.user.tenantId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  @Post()
  async create(@Request() req, @Body() body: any) {
    return this.commsService.create(req.user.tenantId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  @Put(':id')
  async update(@Request() req, @Param('id') id: string, @Body() body: any) {
    return this.commsService.update(id, req.user.tenantId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  @Delete(':id')
  async delete(@Request() req, @Param('id') id: string) {
    return this.commsService.delete(id, req.user.tenantId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  @Post(':id/send')
  async send(
    @Request() req,
    @Param('id') id: string,
    @Body('force') force?: boolean,
  ) {
    return this.commsService.sendCommunication(id, req.user.tenantId, { force: !!force });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  @Post('upload-image')
  @UseInterceptors(FileInterceptor('image'))
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No image uploaded');
    const url = await this.cloudinaryService.uploadImage(file, 'communications');
    return { success: true, url };
  }
}
