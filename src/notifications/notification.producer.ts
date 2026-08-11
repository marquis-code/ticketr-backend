import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class NotificationProducer {
  private readonly logger = new Logger(NotificationProducer.name);

  constructor(@InjectQueue('notifications') private notificationQueue: Queue) {}

  async scheduleEventReminder(eventId: string, userId: string, userEmail: string, fcmTokens: string[], eventName: string, eventDate: Date) {
    const now = new Date();
    // Schedule 2 hours before the event
    const runAt = new Date(eventDate.getTime() - 2 * 60 * 60 * 1000);
    
    let delay = runAt.getTime() - now.getTime();
    
    // If the event is already less than 2 hours away, send it immediately
    if (delay < 0) {
      delay = 0;
    }

    await this.notificationQueue.add(
      'send-event-reminder',
      {
        eventId,
        userId,
        userEmail,
        fcmTokens,
        eventName,
        eventDate,
      },
      { delay }
    );
    this.logger.log(`Scheduled reminder for event ${eventId} and user ${userId} in ${delay}ms`);
  }
}
