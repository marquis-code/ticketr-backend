import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FcmService } from './fcm.service';
import { NotificationProducer } from './notification.producer';
import { NotificationConsumer } from './notification.consumer';
import { ResendModule } from '../resend/resend.module';

@Module({
  imports: [
    ResendModule,
    BullModule.registerQueue({
      name: 'notifications',
    }),
  ],
  providers: [FcmService, NotificationProducer, NotificationConsumer],
  exports: [FcmService, NotificationProducer],
})
export class NotificationsModule {}
