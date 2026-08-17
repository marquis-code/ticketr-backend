import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type EventDocument = Event & Document;

export enum EventStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
}

export enum EventVisibility {
  PUBLIC = 'PUBLIC',
  UNIVERSITY_ONLY = 'UNIVERSITY_ONLY',
  PRIVATE = 'PRIVATE',
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

  @Prop({ type: [String], default: [] })
  galleryImages: string[];

  @Prop({ required: true })
  location: string; // Physical address or Virtual Meeting URL

  @Prop({ default: false })
  isVirtual: boolean;

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  endDate: Date;

  @Prop()
  checkInStart?: Date;

  @Prop()
  checkInEnd?: Date;

  @Prop({ type: String, enum: EventStatus, default: EventStatus.PUBLISHED, index: true })
  status: EventStatus;

  @Prop({ type: String, enum: EventVisibility, default: EventVisibility.PUBLIC, index: true })
  visibility: EventVisibility;

  @Prop({ required: true, default: 0 })
  capacity: number; // For Waitlists and predictive models

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({
    type: [{
      code: { type: String, required: true },
      type: { type: String, enum: ['PERCENTAGE', 'FLAT'], default: 'PERCENTAGE' },
      value: { type: Number, required: true },
      maxUses: { type: Number, default: null },
      usedCount: { type: Number, default: 0 },
      expiresAt: { type: Date, default: null },
      isActive: { type: Boolean, default: true },
    }],
    default: [],
  })
  promoCodes: Array<{
    code: string;
    type: 'PERCENTAGE' | 'FLAT';
    value: number;
    maxUses?: number;
    usedCount?: number;
    expiresAt?: Date;
    isActive?: boolean;
  }>;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdBy: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  updatedBy?: string;
}

export const EventSchema = SchemaFactory.createForClass(Event);
EventSchema.index({ tenantId: 1, slug: 1 }, { unique: true });
