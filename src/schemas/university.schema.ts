import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UniversityDocument = University & Document;

@Schema({ timestamps: true })
export class University {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true, index: true })
  domain: string; // e.g. "unilag.edu.ng"

  @Prop({ trim: true })
  location?: string;

  @Prop()
  logoUrl?: string;

  @Prop({ default: true })
  isActive: boolean;
}

export const UniversitySchema = SchemaFactory.createForClass(University);
