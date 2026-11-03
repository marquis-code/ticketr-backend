import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User, UserDocument, UserRole } from '../schemas/user.schema';
import { Tenant, TenantDocument } from '../schemas/tenant.schema';
import { ResendService } from '../resend/resend.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Tenant.name) private tenantModel: Model<TenantDocument>,
    private jwtService: JwtService,
    private resendService: ResendService,
  ) {}

  async register(dto: {
    name: string;
    email: string;
    password: string;
    role?: UserRole;
    tenantSlug?: string;
    organizationName?: string;
  }) {
    const email = (dto.email || '').trim().toLowerCase();
    const name = (dto.name || '').trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      throw new BadRequestException('Please provide a valid email address');
    }
    if (name.length < 2 || name.length > 80) {
      throw new BadRequestException('Please provide your full name');
    }
    this.assertStrongPassword(dto.password);

    // SECURITY: never trust privileged roles from a public registration payload.
    // Only CUSTOMER and ORGANIZER accounts can be self-created. Staff, super admins
    // and additional organizers are invited by an existing tenant admin.
    const requestedRole = dto.role;
    if (requestedRole && ![UserRole.CUSTOMER, UserRole.ORGANIZER].includes(requestedRole)) {
      throw new BadRequestException('This account type cannot be self-registered');
    }

    const existing = await this.userModel.findOne({ email });
    if (existing) {
      throw new BadRequestException('An account with this email already exists. Please sign in instead.');
    }

    let tenantId: string | undefined;

    if (requestedRole === UserRole.ORGANIZER) {
      const organizationName = (dto.organizationName || '').trim();
      const rawSlug = (dto.tenantSlug || organizationName).toLowerCase().trim();
      const slug = rawSlug.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

      if (!organizationName || organizationName.length < 2) {
        throw new BadRequestException('Organization name is required to create an organizer account');
      }
      if (!slug || slug.length < 3) {
        throw new BadRequestException('Organization handle must be at least 3 characters');
      }

      // SECURITY: an organizer can only create a NEW organization. Joining an existing
      // tenant by guessing its slug would grant access to another organizer's data.
      const taken = await this.tenantModel.findOne({ slug });
      if (taken) {
        throw new BadRequestException('That organization handle is already taken. Please choose another.');
      }

      const tenant = await this.tenantModel.create({
        name: organizationName,
        slug,
        contactEmail: email,
      });
      tenantId = tenant._id.toString();
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.userModel.create({
      name,
      email,
      passwordHash,
      role: requestedRole || UserRole.CUSTOMER,
      tenantId,
    });

    return this.generateAuthResponse(user);
  }

  private assertStrongPassword(password?: string) {
    if (!password || password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long');
    }
    if (password.length > 128) {
      throw new BadRequestException('Password is too long');
    }
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      throw new BadRequestException('Password must include at least one letter and one number');
    }
  }

  async login(dto: { email: string; password: string }) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.userModel.findOne({ email });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('This account has been disabled. Please contact support.');
    }

    if (user.tenantId) {
      const tenant = await this.tenantModel.findById(user.tenantId);
      if (!tenant || tenant.status !== 'ACTIVE') {
        throw new UnauthorizedException('This organization is not active. Please contact support.');
      }
    }

    // Apply OTP for ORGANIZER and SUPER_ADMIN accounts
    // if (user.role === UserRole.ORGANIZER || user.role === UserRole.SUPER_ADMIN) {
    //   const otp = Math.floor(100000 + Math.random() * 900000).toString();
    //   user.otpSecret = otp;
    //   user.otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    //   await user.save();
    //
    //   await this.resendService.sendLoginOTPEmail(user.email, otp, user.name);
    //
    //   return {
    //     requireOtp: true,
    //     message: 'OTP sent to email',
    //     email: user.email
    //   };
    // }

    return this.generateAuthResponse(user);
  }

  async verifyLoginOtp(dto: { email: string; otp: string }) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.userModel.findOne({ email });
    if (!user || (user.role !== UserRole.ORGANIZER && user.role !== UserRole.SUPER_ADMIN)) {
      throw new UnauthorizedException('Invalid user');
    }

    if (!user.otpSecret || !user.otpExpires) {
      throw new BadRequestException('No OTP requested');
    }

    if (user.otpExpires < new Date()) {
      throw new BadRequestException('OTP expired');
    }

    if (user.otpSecret !== dto.otp) {
      throw new UnauthorizedException('Invalid OTP');
    }

    // Clear OTP
    user.otpSecret = undefined;
    user.otpExpires = undefined;
    await user.save();

    return this.generateAuthResponse(user);
  }

  async forgotPassword(emailInput: string, origin?: string) {
    const email = emailInput.trim().toLowerCase();
    const user = await this.userModel.findOne({ email });
    if (!user) {
      // Return success anyway to prevent enumeration
      return { message: 'If the email exists, a reset link has been sent.' };
    }

    const token = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = token;
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    // SECURITY: never build the reset link from an attacker-controlled Origin header.
    // Only configured application origins are allowed, which prevents host-header
    // poisoning from stealing password reset tokens.
    const configured = [
      process.env.FRONTEND_URL,
      process.env.ADMIN_URL,
      process.env.SUPER_ADMIN_URL,
    ].filter(Boolean) as string[];

    const allowedOrigins = new Set(
      configured.map((u) => {
        try { return new URL(u).origin; } catch { return ''; }
      }).filter(Boolean),
    );
    if (process.env.NODE_ENV !== 'production') {
      allowedOrigins.add('http://localhost:3002');
      allowedOrigins.add('http://localhost:3003');
      allowedOrigins.add('http://localhost:3004');
    }

    let baseUrl = process.env.FRONTEND_URL || configured[0] || 'http://localhost:3002';
    if (origin) {
      try {
        const originUrl = new URL(origin);
        if (allowedOrigins.has(originUrl.origin)) baseUrl = originUrl.origin;
      } catch { /* ignore malformed origin */ }
    }

    let path = '/reset-password';
    if (user.role === UserRole.ORGANIZER || user.role === UserRole.SUPER_ADMIN) {
      path = '/admin/reset-password';
    }

    const resetLink = `${baseUrl.replace(/\/+$/, '')}${path}?token=${token}`;
    await this.resendService.sendPasswordResetEmail(user.email, resetLink, user.name);

    return { message: 'If the email exists, a reset link has been sent.' };
  }

  async resetPassword(dto: { token: string; password: string }) {
    const user = await this.userModel.findOne({
      resetPasswordToken: dto.token,
      resetPasswordExpires: { $gt: new Date() }
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    this.assertStrongPassword(dto.password);
    user.passwordHash = await bcrypt.hash(dto.password, 12);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    return { message: 'Password has been reset successfully' };
  }

  async getProfile(userId: string) {
    const user = await this.userModel.findById(userId).populate('tenantId').exec();
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const tenant = user.tenantId as any;
    let tenantView: any = null;
    if (tenant) {
      const base = {
        id: tenant._id?.toString(),
        name: tenant.name,
        slug: tenant.slug,
        logoUrl: tenant.logoUrl,
        primaryColor: tenant.primaryColor,
        secondaryColor: tenant.secondaryColor,
        contactEmail: tenant.contactEmail,
        contactPhone: tenant.contactPhone,
        status: tenant.status,
        paymentMethod: tenant.paymentMethod,
        notificationEmails: tenant.notificationEmails,
        primaryRemittanceAccount: tenant.primaryRemittanceAccount,
        remittanceAccount: tenant.remittanceAccount,
        secondaryRemittanceAccount: tenant.secondaryRemittanceAccount,
        customDomain: tenant.customDomain,
      };
      // Gate staff only need identity for the scanner/roster. Payout and
      // integration credentials stay with organizers.
      tenantView =
        user.role === UserRole.STAFF || user.role === UserRole.CUSTOMER
          ? {
              id: tenant._id?.toString(),
              name: tenant.name,
              slug: tenant.slug,
              logoUrl: tenant.logoUrl,
              status: tenant.status,
            }
          : base;
    }

    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      tenant: tenantView,
    };
  }

  async impersonateOrganizer(tenantId: string) {
    const organizer = await this.userModel.findOne({ tenantId, role: UserRole.ORGANIZER });
    if (!organizer) {
      throw new BadRequestException('No organizer found for this tenant');
    }
    return { ...this.generateAuthResponse(organizer), impersonated: true };
  }

  async inviteTeamMember(tenantId: string, dto: { name: string; email: string; role: UserRole }) {
    if (![UserRole.ORGANIZER, UserRole.STAFF].includes(dto.role)) {
      throw new BadRequestException('Team members can only be organizers or gate staff');
    }
    const email = dto.email.trim().toLowerCase();
    const existing = await this.userModel.findOne({ email });
    if (existing) {
      throw new BadRequestException('An account with this email already exists');
    }
    // Invitees receive a one-time password-reset style link to set their password.
    const token = crypto.randomBytes(32).toString('hex');
    const user = await this.userModel.create({
      name: dto.name.trim(),
      email,
      passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12),
      role: dto.role,
      tenantId,
      resetPasswordToken: token,
      resetPasswordExpires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const baseUrl = process.env.ADMIN_URL || process.env.FRONTEND_URL || 'http://localhost:3003';
    await this.resendService.sendPasswordResetEmail(
      email,
      `${baseUrl.replace(/\/+$/, '')}/reset-password?token=${token}`,
      user.name,
    );
    return { id: user._id.toString(), name: user.name, email: user.email, role: user.role };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new BadRequestException('User not found');
    const valid = await bcrypt.compare(currentPassword || '', user.passwordHash);
    if (!valid) throw new UnauthorizedException('Your current password is incorrect');
    this.assertStrongPassword(newPassword);
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await user.save();
    return { message: 'Password updated successfully' };
  }

  async updateProfile(userId: string, dto: { name?: string; phone?: string }) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new BadRequestException('User not found');
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (name.length < 2) throw new BadRequestException('Please provide your full name');
      user.name = name;
    }
    await user.save();
    return { id: user._id.toString(), name: user.name, email: user.email, role: user.role };
  }

  async getTenantUsers(tenantId: string) {
    const users = await this.userModel.find({ tenantId }).select('_id name email role').exec();
    return users.map(u => ({
      id: u._id.toString(),
      name: u.name,
      email: u.email,
      role: u.role,
    }));
  }

  private generateAuthResponse(user: UserDocument) {
    const payload = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
      tenantId: user.tenantId ? user.tenantId.toString() : undefined,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId ? user.tenantId.toString() : undefined,
      },
    };
  }
}
