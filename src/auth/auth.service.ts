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
    const existing = await this.userModel.findOne({ email: dto.email.toLowerCase() });
    if (existing) {
      throw new BadRequestException('User with this email already exists');
    }

    let tenantId: string | undefined;

    if (dto.role === UserRole.ORGANIZER && dto.tenantSlug) {
      let tenant = await this.tenantModel.findOne({ slug: dto.tenantSlug.toLowerCase() });
      if (!tenant && dto.organizationName) {
        tenant = await this.tenantModel.create({
          name: dto.organizationName,
          slug: dto.tenantSlug.toLowerCase(),
          contactEmail: dto.email.toLowerCase(),
        });
      }
      if (tenant) {
        tenantId = tenant._id.toString();
      }
    } else if (dto.tenantSlug) {
      const tenant = await this.tenantModel.findOne({ slug: dto.tenantSlug.toLowerCase() });
      if (tenant) {
        tenantId = tenant._id.toString();
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.userModel.create({
      name: dto.name,
      email: dto.email.toLowerCase(),
      passwordHash,
      role: dto.role || UserRole.CUSTOMER,
      tenantId,
    });

    return this.generateAuthResponse(user);
  }

  async login(dto: { email: string; password: string }) {
    const user = await this.userModel.findOne({ email: dto.email.toLowerCase() });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Apply OTP for ORGANIZER and SUPER_ADMIN accounts
    if (user.role === UserRole.ORGANIZER || user.role === UserRole.SUPER_ADMIN) {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      user.otpSecret = otp;
      user.otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      await user.save();

      await this.resendService.sendLoginOTPEmail(user.email, otp, user.name);

      return {
        requireOtp: true,
        message: 'OTP sent to email',
        email: user.email
      };
    }

    return this.generateAuthResponse(user);
  }

  async verifyLoginOtp(dto: { email: string; otp: string }) {
    const user = await this.userModel.findOne({ email: dto.email.toLowerCase() });
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

  async forgotPassword(email: string) {
    const user = await this.userModel.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Return success anyway to prevent enumeration
      return { message: 'If the email exists, a reset link has been sent.' };
    }

    const token = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = token;
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    // In a real production app, the frontend URL should be loaded from env.
    const resetLink = `http://localhost:3003/reset-password?token=${token}`; 
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

    user.passwordHash = await bcrypt.hash(dto.password, 10);
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
    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      tenant: user.tenantId,
    };
  }

  async impersonateOrganizer(tenantId: string) {
    const organizer = await this.userModel.findOne({ tenantId, role: UserRole.ORGANIZER });
    if (!organizer) {
      throw new BadRequestException('No organizer found for this tenant');
    }
    return this.generateAuthResponse(organizer);
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
