import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type TenantDocument = Tenant & Document;

export enum TenantStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  PENDING = 'PENDING',
}

export enum PaymentMethod {
  PAYSTACK = 'PAYSTACK',
  MANUAL_TRANSFER = 'MANUAL_TRANSFER',
}

@Schema({ timestamps: true })
export class Tenant {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'University', index: true })
  universityId?: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true, index: true })
  slug: string; // e.g. "nursing" -> nursing.ticketr.org

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

  @Prop({ type: String, enum: PaymentMethod, default: PaymentMethod.PAYSTACK })
  paymentMethod: PaymentMethod;

  @Prop()
  paystackSubaccountCode?: string; // For split payouts to tenants

  @Prop({ type: Object })
  primaryRemittanceAccount?: {
    bankName?: string;
    bankCode?: string;
    accountNumber?: string;
    accountName?: string;
  };

  @Prop({ type: Object })
  remittanceAccount?: {
    bankName?: string;
    bankCode?: string;
    accountNumber?: string;
    accountName?: string;
  };

  @Prop({ type: Object })
  secondaryRemittanceAccount?: {
    bankName?: string;
    bankCode?: string;
    accountNumber?: string;
    accountName?: string;
  };

  @Prop({ type: [String], default: [] })
  notificationEmails: string[];
}

export const TenantSchema = SchemaFactory.createForClass(Tenant);
