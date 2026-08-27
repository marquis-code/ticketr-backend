import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type CommunicationDocument = Communication & Document;

export enum CommunicationStatus {
  DRAFT = 'DRAFT',
  SENDING = 'SENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

@Schema({ timestamps: true })
export class Communication {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: string;

  @Prop({ required: true })
  audience: string; // 'all', 'event', or 'custom'

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Event' })
  eventId?: string;

  @Prop({ type: [String], default: [] })
  customEmails?: string[];

  @Prop({ required: true })
  subject: string;

  @Prop({ required: true })
  message: string;

  @Prop({ type: String, enum: CommunicationStatus, default: CommunicationStatus.DRAFT, index: true })
  status: CommunicationStatus;
}

export const CommunicationSchema = SchemaFactory.createForClass(Communication);
