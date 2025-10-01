import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type NotificationDocument = Notification & Document;

@Schema()
export class Notification {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  type: 'message' | 'github' | 'system';

  @Prop({ type: Object })
  data: Record<string, any>;

  @Prop({ default: false })
  read: boolean;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(
  Notification,
).index({
  userId: 1,
  createdAt: -1,
});
