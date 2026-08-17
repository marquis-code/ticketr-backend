import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MongooseModule } from '@nestjs/mongoose';
import { FcmService } from './fcm.service';
import { NotificationProducer } from './notification.producer';
import { NotificationConsumer } from './notification.consumer';
import { CronService } from './cron.service';
import { Order, OrderSchema } from '../schemas/order.schema';
import { Event, EventSchema } from '../schemas/event.schema';
import { ResendModule } from '../resend/resend.module';

@Module({
  imports: [
    ResendModule,
    BullModule.registerQueue({
      name: 'notifications',
    }),
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: Event.name, schema: EventSchema },
    ]),
  ],
  providers: [FcmService, NotificationProducer, NotificationConsumer, CronService],
  exports: [FcmService, NotificationProducer],
})
export class NotificationsModule {}
