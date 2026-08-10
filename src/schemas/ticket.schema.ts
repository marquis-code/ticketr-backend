import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type TicketDocument = Ticket & Document;

export enum TicketStatus {
  ISSUED = 'ISSUED',
  CHECKED_IN = 'CHECKED_IN',
  CANCELLED = 'CANCELLED',
}

@Schema({ timestamps: true })
export class Ticket {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Event', required: true, index: true })
  eventId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Order', required: true, index: true })
  orderId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'TicketTier', required: true })
  tierId: string;

  @Prop({ required: true, unique: true, index: true })
  ticketNumber: string; // Formatted ticket code e.g. V/T01/EDM, R/T10/TVESA, VV/T02/ULSESA

  @Prop()
  departmentCode?: string;

  @Prop({ required: true })
  attendeeName: string;

  @Prop({ required: true, lowercase: true })
  attendeeEmail: string;

  @Prop({ required: true, unique: true, index: true })
  qrCodeHash: string; // HMAC token encoded inside QR code image

  @Prop({ type: String, enum: TicketStatus, default: TicketStatus.ISSUED, index: true })
  status: TicketStatus;

  @Prop()
  checkedInAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  checkedInBy?: string; // Scanner staff user ID
}

export const TicketSchema = SchemaFactory.createForClass(Ticket);
