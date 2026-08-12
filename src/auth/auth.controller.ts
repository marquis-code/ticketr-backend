import { Controller, Post, Body, Get, UseGuards, Request, Headers } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { UserRole } from '../schemas/user.schema';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

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

  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body);
  }

  @Post('verify-login-otp')
  async verifyLoginOtp(@Body() body: { email: string; otp: string }) {
    return this.authService.verifyLoginOtp(body);
  }

  @Post('forgot-password')
  async forgotPassword(@Body() body: { email: string }, @Headers('origin') origin: string) {
    return this.authService.forgotPassword(body.email, origin);
  }

  @Post('reset-password')
  async resetPassword(@Body() body: { token: string; password: string }) {
    return this.authService.resetPassword(body);
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
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  @Get('tenant-users')
  async getTenantUsers(@Request() req) {
    const tenantId = req.user.tenantId;
    return this.authService.getTenantUsers(tenantId);
  }
}
