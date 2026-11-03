import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type OrderDocument = Order & Document;

export enum OrderStatus {
  PENDING = 'PENDING',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PAID = 'PAID',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
}

export class OrderItem {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'TicketTier', required: true })
  tierId: string;

  @Prop()
  tierDescription?: string;

  @Prop({ default: 0 })
  markupAmount?: number;

  @Prop({ default: 0 })
  reservedUnits?: number;

  @Prop({ required: true })
  tierName: string;

  @Prop({ required: true })
  unitPrice: number;

  @Prop({ required: true, min: 1 })
  quantity: number;

  @Prop({ required: true })
  subtotal: number;

  @Prop({ type: [{ name: String, email: String, departmentCode: String, customData: { type: Map, of: String } }] })
  attendees?: { name: string; email: string; departmentCode?: string; customData?: Map<string, string> }[];
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

  @Prop()
  promoCode?: string;

  @Prop()
  discountAmount?: number;

  @Prop({ default: false })
  isInstallmentPlan: boolean;

  @Prop({ default: 0 })
  amountPaid: number;

  @Prop({ default: 0 })
  amountRemaining: number;

  @Prop()
  nextPaymentDueDate?: Date;

  @Prop({ index: true })
  paystackReference?: string;

  /** Bearer token for the secure ticket wallet. Only ever shared with the buyer. */
  @Prop({ index: true, unique: true, sparse: true })
  walletToken?: string;

  @Prop({ type: String, default: 'PENDING', index: true })
  fulfillmentStatus?: 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'FAILED';

  @Prop()
  fulfillmentStartedAt?: Date;

  @Prop()
  fulfillmentCompletedAt?: Date;

  @Prop({ index: true })
  reservationExpiresAt?: Date;

  @Prop({ type: String, enum: ['HELD', 'CONSUMED', 'RELEASED', 'NONE'], default: 'NONE', index: true })
  reservationState?: 'HELD' | 'CONSUMED' | 'RELEASED' | 'NONE';

  @Prop()
  balancePaymentReference?: string;

  @Prop()
  cancelledAt?: Date;

  @Prop()
  cancellationReason?: string;

  /** Idempotency claims for scheduled reminder emails. */
  @Prop({ type: Object, default: {} })
  reminders?: {
    abandonedAt?: Date;
    dayBeforeAt?: Date;
    hoursBeforeAt?: Date;
    balanceDueAt?: Date;
  };

  @Prop({ default: 0 })
  platformFee?: number;

  @Prop({ default: 0 })
  netToOrganizer?: number;

  @Prop({ default: 0 })
  ticketsIssued?: number;

  @Prop({ type: String, default: 'WEB' })
  channel?: 'WEB' | 'INTERNAL' | 'RESALE' | 'API';

  @Prop()
  promoReservedAt?: Date;

  @Prop()
  paystackAccessCode?: string;

  @Prop()
  paidAt?: Date;

  @Prop()
  proofOfPaymentUrl?: string;

  @Prop({ index: true })
  bankReference?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  approvedBy?: string;

  @Prop()
  forceApproveReason?: string;

  @Prop({ type: String, default: 'PAYMENT_PENDING' })
  checkoutStep?: string;

  @Prop({ default: 'PAYSTACK' })
  paymentMethod: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  updatedBy?: string;

  @Prop({ index: true })
  refundedAt?: Date;

  @Prop({ default: 0 })
  refundAmount?: number;

  @Prop()
  refundReason?: string;

  @Prop()
  refundReference?: string;

  @Prop({ type: String, enum: ['PAYSTACK', 'MANUAL'], default: 'PAYSTACK' })
  refundMethod?: 'PAYSTACK' | 'MANUAL';

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  refundedBy?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Payout', index: true })
  payoutId?: string;

  @Prop()
  paidOutAt?: Date;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
