import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type ResaleListingDocument = ResaleListing & Document;

export enum ResaleStatus {
  AVAILABLE = 'AVAILABLE',
  SOLD = 'SOLD',
  CANCELLED = 'CANCELLED',
}

@Schema({ timestamps: true })
export class ResaleListing {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ticket', required: true, index: true })
  ticketId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Event', required: true, index: true })
  eventId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  sellerId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  buyerId?: string;

  @Prop({ required: true })
  askingPrice: number;

  @Prop({ type: String, enum: ResaleStatus, default: ResaleStatus.AVAILABLE, index: true })
  status: ResaleStatus;

  @Prop()
  soldAt?: Date;

  @Prop()
  buyerName?: string;

  @Prop()
  buyerEmail?: string;

  @Prop({ index: true, sparse: true })
  paymentReference?: string;

  @Prop({ default: 0 })
  sellerPayout?: number;

  @Prop({ default: 0 })
  platformFee?: number;

  @Prop({ type: String, enum: ['PENDING', 'PAID', 'FAILED'], default: 'PENDING' })
  paymentStatus?: 'PENDING' | 'PAID' | 'FAILED';
}

export const ResaleListingSchema = SchemaFactory.createForClass(ResaleListing);
