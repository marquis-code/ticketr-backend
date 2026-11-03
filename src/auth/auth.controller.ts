import { Controller, Post, Patch, Body, Get, UseGuards, Request, Headers, BadRequestException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { UserRole } from '../schemas/user.schema';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async register(
    @Body()
    body: {
      name: string;
      email: string;
      password: string;
      role?: UserRole;
      tenantSlug?: string;
      organizationName?: string;
    },
  ) {
    return this.authService.register(body);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000, blockDuration: 120_000 } })
  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify-login-otp')
  async verifyLoginOtp(@Body() body: { email: string; otp: string }) {
    return this.authService.verifyLoginOtp(body);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  async forgotPassword(@Body() body: { email: string }, @Headers('origin') origin: string) {
    return this.authService.forgotPassword(body.email, origin);
  }

  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('reset-password')
  async resetPassword(@Body() body: { token: string; password: string }) {
    return this.authService.resetPassword(body);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateProfile(@Request() req, @Body() body: { name?: string }) {
    return this.authService.updateProfile(req.user.userId, body);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('password')
  async changePassword(
    @Request() req,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    return this.authService.changePassword(req.user.userId, body.currentPassword, body.newPassword);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getProfile(@Request() req) {
    return this.authService.getProfile(req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Post('impersonate')
  async impersonate(@Body() body: { tenantId: string }) {
    return this.authService.impersonateOrganizer(body.tenantId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Post('invite')
  async inviteTeamMember(
    @Request() req,
    @Body() body: { name: string; email: string; role: UserRole },
  ) {
    if (!req.user.tenantId) throw new BadRequestException('User is not associated with an organization');
    return this.authService.inviteTeamMember(req.user.tenantId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  @Get('tenant-users')
  async getTenantUsers(@Request() req) {
    const tenantId = req.user.tenantId;
    return this.authService.getTenantUsers(tenantId);
  }
}
