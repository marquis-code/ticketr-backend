import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { FcmService } from './fcm.service';
import { ResendService } from '../resend/resend.service';

@Processor('notifications')
export class NotificationConsumer extends WorkerHost {
  private readonly logger = new Logger(NotificationConsumer.name);

  constructor(
    private readonly fcmService: FcmService,
    private readonly resendService: ResendService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);

    switch (job.name) {
      case 'send-event-reminder':
        await this.handleEventReminder(job.data);
        break;
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async handleEventReminder(data: any) {
    const { userEmail, fcmTokens, eventName, eventDate } = data;
    const formattedDate = new Date(eventDate).toLocaleString();

    // 1. Send Email Reminder
    if (userEmail) {
      try {
        await this.resendService.sendEmail(
          userEmail,
          `Reminder: ${eventName} is starting soon!`,
          `<p>Hi there,</p><p>This is a reminder that <strong>${eventName}</strong> starts at ${formattedDate}.</p><p>We can't wait to see you there!</p>`,
        );
        this.logger.log(`Email reminder sent to ${userEmail}`);
      } catch (error) {
        this.logger.error(`Failed to send email to ${userEmail}`, error);
      }
    }

    // 2. Send Push Notification
    if (fcmTokens && fcmTokens.length > 0) {
      try {
        await this.fcmService.sendMulticastPushNotification(
          fcmTokens,
          `Upcoming Event: ${eventName}`,
          `Starts at ${formattedDate}. Tap to view your ticket.`,
          { eventId: data.eventId }
        );
      } catch (error) {
        this.logger.error(`Failed to send push notification to ${fcmTokens.length} devices`, error);
      }
    }
  }
}
