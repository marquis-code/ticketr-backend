import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);

  constructor(private configService: ConfigService) {
    const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');
    const privateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY');
    
    if (projectId && clientEmail && privateKey && getApps().length === 0) {
      try {
        initializeApp({
          credential: cert({
            projectId,
            clientEmail,
            privateKey: privateKey.replace(/\\n/g, '\n'),
          }),
        });
        this.logger.log('Firebase Admin initialized successfully.');
      } catch (error) {
        this.logger.error('Failed to initialize Firebase Admin', error);
      }
    } else if (getApps().length === 0) {
      this.logger.warn('Firebase credentials not fully provided in .env. Push notifications disabled.');
    }
  }

  async sendPushNotification(token: string, title: string, body: string, data?: Record<string, string>) {
    if (getApps().length === 0) {
      this.logger.warn('Firebase Admin not initialized. Skipping push notification.');
      return;
    }

    try {
      const message = {
        notification: {
          title,
          body,
        },
        data: data || {},
        token,
      };

      const response = await getMessaging().send(message);
      this.logger.log(`Successfully sent message: ${response}`);
      return response;
    } catch (error) {
      this.logger.error('Error sending message:', error);
      throw error;
    }
  }

  async sendMulticastPushNotification(tokens: string[], title: string, body: string, data?: Record<string, string>) {
    if (getApps().length === 0) {
      this.logger.warn('Firebase Admin not initialized. Skipping multicast push notification.');
      return;
    }
    
    if (!tokens || tokens.length === 0) return;

    try {
      const message = {
        notification: {
          title,
          body,
        },
        data: data || {},
        tokens,
      };

      const response = await getMessaging().sendEachForMulticast(message);
      this.logger.log(`Successfully sent ${response.successCount} messages; ${response.failureCount} failed.`);
      return response;
    } catch (error) {
      this.logger.error('Error sending multicast message:', error);
      throw error;
    }
  }
}
