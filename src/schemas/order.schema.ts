import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type OrderDocument = Order & Document;

export enum OrderStatus {
  PENDING = 'PENDING',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  PAID = 'PAID',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export class OrderItem {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'TicketTier', required: true })
  tierId: string;

  @Prop({ required: true })
  tierName: string;

  @Prop({ required: true })
  unitPrice: number;

  @Prop({ required: true, min: 1 })
  quantity: number;

  @Prop({ required: true })
  subtotal: number;

  @Prop({ type: [{ name: String, email: String, departmentCode: String }] })
  attendees?: { name: string; email: string; departmentCode?: string }[];
}

@Schema({ timestamps: true })
export class Order {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Event', required: true, index: true })
  eventId: string;

  @Prop({ required: true, unique: true, index: true })
  orderNumber: string; // e.g. "CMT-20260809-A8F1"

  @Prop({ required: true })
  customerName: string;

  @Prop({ required: true, lowercase: true, index: true })
  customerEmail: string;

  @Prop()
  customerPhone?: string;

  @Prop()
  departmentCode?: string; // e.g. EDM, TVESA, ULSESA

  @Prop({ type: [OrderItem], required: true })
  items: OrderItem[];

  @Prop({ required: true })
  totalAmount: number;

  @Prop({ default: 'NGN' })
  currency: string;

  @Prop({ type: String, enum: OrderStatus, default: OrderStatus.PENDING, index: true })
  status: OrderStatus;

  @Prop({ index: true })
  paystackReference?: string;

  @Prop()
  paystackAccessCode?: string;

  @Prop()
  paidAt?: Date;

  @Prop()
  proofOfPaymentUrl?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  approvedBy?: string;

  @Prop({ default: 'PAYSTACK' })
  paymentMethod: string;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
