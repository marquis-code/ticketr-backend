import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';

@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);
  private secretKey: string;
  private publicKey: string;

  constructor(private configService: ConfigService) {
    this.secretKey = this.configService.get<string>('PAYSTACK_SECRET_KEY') || 'sk_test_mock';
    this.publicKey = this.configService.get<string>('PAYSTACK_PUBLIC_KEY') || 'pk_test_mock';
  }

  async initializeTransaction(payload: {
    email: string;
    amountInKobo: number; // e.g. 5000 NGN = 500000 Kobo
    reference: string;
    callbackUrl: string;
    subaccount?: string;
    metadata?: any;
  }) {
    if (this.secretKey.startsWith('sk_test_mock')) {
      this.logger.log(`[MOCK PAYSTACK INIT] Reference: ${payload.reference}, Amount: ${payload.amountInKobo}`);
      return {
        authorization_url: `${payload.callbackUrl}?reference=${payload.reference}&status=success`,
        access_code: `access_${payload.reference}`,
        reference: payload.reference,
      };
    }

    try {
      const body: any = {
        email: payload.email,
        amount: payload.amountInKobo,
        reference: payload.reference,
        callback_url: payload.callbackUrl,
        metadata: payload.metadata,
      };

      if (payload.subaccount) {
        body.subaccount = payload.subaccount;
      }

      const response = await axios.post(
        'https://api.paystack.co/transaction/initialize',
        body,
        {
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return response.data.data;
    } catch (error) {
      this.logger.error('Paystack initialization failed', error?.response?.data || error.message);
      throw new BadRequestException('Payment initialization failed via Paystack: ' + (error?.response?.data?.message || error.message));
    }
  }

  async verifyTransaction(reference: string) {
    if (this.secretKey.startsWith('sk_test_mock')) {
      this.logger.log(`[MOCK PAYSTACK VERIFY] Reference: ${reference}`);
      return {
        status: true,
        data: {
          status: 'success',
          reference,
          amount: 500000,
          paid_at: new Date().toISOString(),
        },
      };
    }

    try {
      const response = await axios.get(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        {
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
          },
        },
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Paystack verification failed for ${reference}`, error?.response?.data || error.message);
      throw new BadRequestException('Payment verification failed');
    }
  }

  verifyWebhookSignature(rawBody: string | Buffer, signatureHeader: string): boolean {
    if (!signatureHeader || this.secretKey.startsWith('sk_test_mock')) {
      return true; // Bypass signature verification in dev/mock environment
    }
    const hash = crypto
      .createHmac('sha512', this.secretKey)
      .update(rawBody)
      .digest('hex');

    return hash === signatureHeader;
  }
}
