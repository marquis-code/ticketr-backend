import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { MarkupFeeType, MarkupStrategy } from './event.schema';

export type TicketTierDocument = TicketTier & Document;

@Schema({ timestamps: true })
export class TicketTier {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Event', required: true, index: true })
  eventId: string;

  @Prop({ required: true, trim: true })
  name: string; // VIP, Regular, Early Bird, Student Tier

  @Prop({ default: '' })
  description: string;

  @Prop({ required: true, min: 0 })
  price: number; // In base currency units e.g., 5000 NGN

  @Prop({ required: true, min: 1 })
  capacity: number;

  @Prop({ default: 0, min: 0 })
  soldCount: number;

  @Prop()
  templateImageUrl?: string;

  @Prop({ default: 5, min: 1 })
  maxPerPurchase: number;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: 0 })
  markupFee: number;

  @Prop({ type: String, enum: MarkupFeeType, default: MarkupFeeType.FLAT })
  markupFeeType: MarkupFeeType;

  @Prop({ type: String, enum: MarkupStrategy, default: MarkupStrategy.ADD_TO_FEE })
  markupStrategy: MarkupStrategy;
}

export const TicketTierSchema = SchemaFactory.createForClass(TicketTier);
