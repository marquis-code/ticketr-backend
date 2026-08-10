import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type EventDocument = Event & Document;

export enum EventStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
}

export enum MarkupFeeType {
  FLAT = 'FLAT',
  PERCENTAGE = 'PERCENTAGE',
}

export enum MarkupStrategy {
  ADD_TO_FEE = 'ADD_TO_FEE',
  DEDUCT_FROM_FEE = 'DEDUCT_FROM_FEE',
}

@Schema({ timestamps: true })
export class Event {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: string;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true, index: true })
  slug: string;

  @Prop({ required: true })
  description: string;

  @Prop()
  bannerUrl?: string;

  @Prop({ type: [String], default: [] })
  carouselImages: string[];

  @Prop({ required: true })
  location: string; // Physical address or Virtual Meeting URL

  @Prop({ default: false })
  isVirtual: boolean;

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  endDate: Date;

  @Prop({ type: String, enum: EventStatus, default: EventStatus.PUBLISHED, index: true })
  status: EventStatus;

  @Prop({ default: 0 })
  markupFee: number;

  @Prop({ type: String, enum: MarkupFeeType, default: MarkupFeeType.FLAT })
  markupFeeType: MarkupFeeType;

  @Prop({ type: String, enum: MarkupStrategy, default: MarkupStrategy.ADD_TO_FEE })
  markupStrategy: MarkupStrategy;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdBy: string;
}

export const EventSchema = SchemaFactory.createForClass(Event);
EventSchema.index({ tenantId: 1, slug: 1 }, { unique: true });
