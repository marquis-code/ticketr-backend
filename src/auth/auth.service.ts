import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument, UserRole } from '../schemas/user.schema';
import { Tenant, TenantDocument } from '../schemas/tenant.schema';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Tenant.name) private tenantModel: Model<TenantDocument>,
    private jwtService: JwtService,
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

    // If registering an ORGANIZER (Tenant Admin) and organization details are provided, create tenant
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

    return this.generateAuthResponse(user);
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
