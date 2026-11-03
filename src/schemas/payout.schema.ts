import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type PayoutDocument = Payout & Document;

export enum PayoutStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  PAID = 'PAID',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

@Schema({ timestamps: true })
export class Payout {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: string;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ default: 'NGN' })
  currency: string;

  @Prop({ type: String, enum: PayoutStatus, default: PayoutStatus.PENDING, index: true })
  status: PayoutStatus;

  @Prop({ default: 0 })
  orderCount: number;

  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Order' }], default: [] })
  orderIds: string[];

  @Prop()
  periodStart?: Date;

  @Prop()
  periodEnd?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  requestedBy?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  processedBy?: string;

  @Prop()
  reference?: string;

  @Prop()
  note?: string;

  @Prop()
  paidAt?: Date;

  @Prop()
  failureReason?: string;
}

export const PayoutSchema = SchemaFactory.createForClass(Payout);
PayoutSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
