import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TenantDocument = Tenant & Document;

export enum TenantStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  PENDING = 'PENDING',
}

@Schema({ timestamps: true })
export class Tenant {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true, index: true })
  slug: string; // e.g. "nursing" -> nursing.cmultickets.com

  @Prop({ trim: true, lowercase: true })
  customDomain?: string; // e.g. "tickets.nursingschool.edu"

  @Prop()
  logoUrl?: string;

  @Prop({ default: '#4f46e5' })
  primaryColor: string;

  @Prop({ default: '#0f172a' })
  secondaryColor: string;

  @Prop({ required: true })
  contactEmail: string;

  @Prop()
  contactPhone?: string;

  @Prop({ type: String, enum: TenantStatus, default: TenantStatus.ACTIVE })
  status: TenantStatus;

  @Prop()
  paystackSubaccountCode?: string; // For split payouts to tenants
}

export const TenantSchema = SchemaFactory.createForClass(Tenant);
