import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import * as QRCode from 'qrcode';

@Injectable()
export class ResendService {
  private readonly logger = new Logger(ResendService.name);
  private resend: Resend;
  private fromEmail: string;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    this.resend = new Resend(apiKey || 're_mock');
    this.fromEmail = this.configService.get<string>('RESEND_FROM_EMAIL') || 'Ticketr <tickets@ticketr.org>';
  }

  async generateQRCodeDataUri(hash: string): Promise<string> {
    return QRCode.toDataURL(hash, { margin: 1, width: 300 });
  }

  async sendTicketEmail(payload: {
    toEmail: string;
    customerName: string;
    eventName: string;
    eventDate: string;
    eventLocation: string;
    ticketNumber: string;
    tierName: string;
    qrCodeHash: string;
    ticketImageUrl?: string;
  }) {
    try {
      const qrDataUri = await this.generateQRCodeDataUri(payload.qrCodeHash);

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; color: #0f172a; margin: 0; padding: 20px; }
            .card { max-width: 500px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.08); border: 1px solid #e2e8f0; }
            .header { background: linear-gradient(135deg, #4f46e5, #7c3aed); padding: 30px; color: #ffffff; text-align: center; }
            .header h1 { margin: 0; font-size: 24px; font-weight: 700; }
            .body { padding: 30px; }
            .info-group { margin-bottom: 20px; }
            .label { font-size: 12px; text-transform: uppercase; color: #64748b; font-weight: 600; letter-spacing: 0.5px; }
            .value { font-size: 16px; font-weight: 600; color: #0f172a; margin-top: 4px; }
            .qr-container { text-align: center; margin: 30px 0 10px; padding: 20px; background: #f1f5f9; border-radius: 12px; }
            .qr-container img { width: 200px; height: 200px; }
            .footer { text-align: center; padding: 20px; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="header">
              <h1>🎉 Your Event Ticket</h1>
              <p style="margin-top: 6px; opacity: 0.9;">Ticketr Ticket Confirmation</p>
            </div>
            <div class="body">
              <p>Hi <strong>${payload.customerName}</strong>,</p>
              <p>Your ticket for <strong>${payload.eventName}</strong> is confirmed!</p>
              
              <div class="info-group">
                <div class="label">Event</div>
                <div class="value">${payload.eventName}</div>
              </div>

              <div class="info-group">
                <div class="label">Date & Venue</div>
                <div class="value">${payload.eventDate} | ${payload.eventLocation}</div>
              </div>

              <div class="info-group">
                <div class="label">Ticket Type & Number</div>
                <div class="value">${payload.tierName} (${payload.ticketNumber})</div>
              </div>

              <div class="qr-container">
                ${payload.ticketImageUrl 
                  ? `<img src="${payload.ticketImageUrl}" alt="Custom Ticket" style="width:100%; max-width:400px; height:auto; margin-bottom:10px; border-radius:8px;" />` 
                  : ''}
                <img src="${qrDataUri}" alt="Ticket QR Code" />
                <p style="font-size: 11px; color: #64748b; margin-top: 8px;">Present this QR Code at gate entry</p>
              </div>
            </div>
            <div class="footer">
              Powered by Ticketr Platform
            </div>
          </div>
        </body>
        </html>
      `;

      if (this.configService.get<string>('RESEND_API_KEY')?.startsWith('re_mock')) {
        this.logger.log(`[MOCK EMAIL SENT] Ticket sent to ${payload.toEmail} for event ${payload.eventName}`);
        return { success: true, mock: true };
      }

      await this.resend.emails.send({
        from: this.fromEmail,
        to: payload.toEmail,
        subject: `🎟️ Your Ticket for ${payload.eventName} - ${payload.ticketNumber}`,
        html: htmlContent,
      });

      this.logger.log(`Email successfully dispatched to ${payload.toEmail}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to send ticket email to ${payload.toEmail}`, error);
      return { success: false, error: error.message };
    }
  }
}
