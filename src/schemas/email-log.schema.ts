import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum EmailStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

@Schema({ timestamps: true })
export class EmailLog extends Document {
  @Prop({ required: true })
  recipientEmail: string;

  @Prop({ required: true })
  subject: string;

  @Prop({ type: String, enum: EmailStatus, default: EmailStatus.PENDING })
  status: EmailStatus;

  @Prop()
  errorReason?: string;

  @Prop({ default: 0 })
  retryCount: number;

  @Prop({ type: Types.ObjectId, ref: 'Ticket' })
  relatedTicketId?: Types.ObjectId;
  
  @Prop({ type: Types.ObjectId, ref: 'User' })
  relatedUserId?: Types.ObjectId;

  @Prop({ type: Object })
  metadata?: Record<string, any>;
}

export const EmailLogSchema = SchemaFactory.createForClass(EmailLog);
EmailLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 604800 }); // 7 days
