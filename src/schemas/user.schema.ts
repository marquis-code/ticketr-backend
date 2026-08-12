import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type UserDocument = User & Document;

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ORGANIZER = 'ORGANIZER', // Tenant Admin
  STAFF = 'STAFF',       // Gate Scanner
  CUSTOMER = 'CUSTOMER',   // Attendee
}

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true, index: true })
  email: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ type: String, enum: UserRole, default: UserRole.CUSTOMER })
  role: UserRole;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Tenant', index: true })
  tenantId?: string; // Null for SUPER_ADMIN or global CUSTOMER

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'University', index: true })
  universityId?: string;

  @Prop({ type: [String], default: [] })
  interests: string[];

  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'User' }], default: [] })
  following: string[];

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: [String], default: [] })
  fcmTokens: string[];

  @Prop({ type: Object, default: { emailNotifications: true, pushNotifications: true } })
  preferences: { emailNotifications: boolean; pushNotifications: boolean };

  @Prop()
  resetPasswordToken?: string;

  @Prop()
  resetPasswordExpires?: Date;

  @Prop()
  otpSecret?: string; // We can store the 6-digit OTP here

  @Prop()
  otpExpires?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
