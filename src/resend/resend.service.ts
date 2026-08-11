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
    ticketPdfBuffer?: Buffer;
    ticketImageBuffer?: Buffer;
  }) {
    try {
      const qrDataUri = await this.generateQRCodeDataUri(payload.qrCodeHash);

      // If we have the composited ticket image, use it as an inline CID image
      const ticketImageCid = payload.ticketImageBuffer ? 'ticket-image' : null;

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; color: #0f172a; margin: 0; padding: 20px; }
            .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; }
            .header { background: #0F4D3F; padding: 24px 30px; color: #ffffff; text-align: center; }
            .header h1 { margin: 0; font-size: 22px; font-weight: 700; }
            .header p { margin: 6px 0 0; opacity: 0.85; font-size: 14px; }
            .body { padding: 24px 30px; }
            .ticket-image-container { text-align: center; margin: 0 0 20px; }
            .ticket-image-container img { width: 100%; max-width: 560px; height: auto; border-radius: 10px; border: 1px solid #e2e8f0; }
            .info-row { display: flex; margin-bottom: 14px; }
            .info-row .label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600; letter-spacing: 0.5px; min-width: 100px; }
            .info-row .value { font-size: 14px; font-weight: 600; color: #0f172a; }
            .qr-container { text-align: center; margin: 20px 0 10px; padding: 16px; background: #f8fafc; border-radius: 10px; border: 1px solid #e2e8f0; }
            .qr-container img { width: 180px; height: 180px; }
            .footer { text-align: center; padding: 16px; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9; }
            table.info-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
            table.info-table td { padding: 8px 0; vertical-align: top; }
            table.info-table td.label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600; letter-spacing: 0.5px; width: 120px; }
            table.info-table td.value { font-size: 14px; font-weight: 600; color: #0f172a; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="header">
              <h1>🎟️ Your Event Ticket</h1>
              <p>Ticketr Ticket Confirmation</p>
            </div>
            <div class="body">
              <p style="margin-bottom:20px;">Hi <strong>${payload.customerName}</strong>, your ticket for <strong>${payload.eventName}</strong> is confirmed!</p>
              
              ${ticketImageCid
                ? `<div class="ticket-image-container"><img src="cid:${ticketImageCid}" alt="Your Ticket" /></div>`
                : (payload.ticketImageUrl
                  ? `<div class="ticket-image-container"><img src="${payload.ticketImageUrl}" alt="Your Ticket" /></div>`
                  : '')}

              <table class="info-table">
                <tr><td class="label">Event</td><td class="value">${payload.eventName}</td></tr>
                <tr><td class="label">Date</td><td class="value">${payload.eventDate}</td></tr>
                <tr><td class="label">Venue</td><td class="value">${payload.eventLocation}</td></tr>
                <tr><td class="label">Ticket Type</td><td class="value">${payload.tierName}</td></tr>
                <tr><td class="label">Ticket No.</td><td class="value">${payload.ticketNumber}</td></tr>
              </table>

              <div class="qr-container">
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(payload.qrCodeHash)}" alt="Ticket QR Code" />
                <p style="font-size: 11px; color: #64748b; margin: 8px 0 0;">Present this QR Code at gate entry</p>
              </div>
            </div>
            <div class="footer">
              Powered by <strong>Ticketr</strong> | <a href="https://www.ticketr.org" style="color: #94a3b8; text-decoration: none;">www.ticketr.org</a>
            </div>
          </div>
        </body>
        </html>
      `;

      if (this.configService.get<string>('RESEND_API_KEY')?.startsWith('re_mock')) {
        this.logger.log(`[MOCK EMAIL SENT] Ticket sent to ${payload.toEmail} for event ${payload.eventName}`);
        return { success: true, mock: true };
      }

      // Build attachments array
      const attachments: any[] = [];

      if (payload.ticketPdfBuffer) {
        attachments.push({
          filename: `Ticket-${payload.ticketNumber.replace(/\//g, '-')}.pdf`,
          content: payload.ticketPdfBuffer,
        });
      }

      if (payload.ticketImageBuffer) {
        attachments.push({
          filename: `ticket-image.png`,
          content: payload.ticketImageBuffer,
          content_id: ticketImageCid,
        });
      }

      const { error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: payload.toEmail,
        subject: `🎟️ Your Ticket for ${payload.eventName} - ${payload.ticketNumber}`,
        html: htmlContent,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      
      if (error) {
        throw new Error(error.message);
      }

      this.logger.log(`Email with PDF ticket dispatched to ${payload.toEmail}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to send ticket email to ${payload.toEmail}`, error);
      return { success: false, error: error.message };
    }
  }

  async sendOrderNotificationToAdmins(payload: {
    emails: string[];
    customerName: string;
    customerEmail: string;
    orderNumber: string;
    totalAmount: number;
    eventName: string;
    ticketDetails: string;
  }) {
    if (!payload.emails || payload.emails.length === 0) return;

    try {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; color: #0f172a; margin: 0; padding: 20px; }
            .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; }
            .header { background: #0F4D3F; padding: 20px; color: #ffffff; text-align: center; }
            .header h1 { margin: 0; font-size: 20px; font-weight: 700; }
            .body { padding: 20px; }
            .info-row { display: flex; margin-bottom: 12px; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px; }
            .info-row:last-child { border-bottom: none; }
            .label { font-size: 12px; text-transform: uppercase; color: #64748b; font-weight: 600; min-width: 120px; }
            .value { font-size: 14px; font-weight: 600; color: #0f172a; }
            .footer { text-align: center; padding: 16px; font-size: 11px; color: #94a3b8; background: #f8fafc; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="header">
              <h1>🔔 New Order Received</h1>
            </div>
            <div class="body">
              <p>A new payment has been successfully processed on Ticketr.</p>
              
              <div class="info-row">
                <div class="label">Event</div>
                <div class="value">${payload.eventName}</div>
              </div>
              <div class="info-row">
                <div class="label">Order No.</div>
                <div class="value">${payload.orderNumber}</div>
              </div>
              <div class="info-row">
                <div class="label">Customer</div>
                <div class="value">${payload.customerName} (${payload.customerEmail})</div>
              </div>
              <div class="info-row">
                <div class="label">Total Paid</div>
                <div class="value">₦${payload.totalAmount.toLocaleString()}</div>
              </div>
              <div class="info-row">
                <div class="label">Tickets</div>
                <div class="value" style="white-space: pre-wrap;">${payload.ticketDetails}</div>
              </div>
            </div>
            <div class="footer">
              Ticketr Automated Notification System
            </div>
          </div>
        </body>
        </html>
      `;

      if (this.configService.get<string>('RESEND_API_KEY')?.startsWith('re_mock')) {
        this.logger.log(`[MOCK EMAIL SENT] Notification sent to ${payload.emails.join(', ')} for order ${payload.orderNumber}`);
        return { success: true, mock: true };
      }

      const { error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: payload.emails,
        subject: `🔔 New Order: ₦${payload.totalAmount.toLocaleString()} - ${payload.eventName}`,
        html: htmlContent,
      });
      
      if (error) {
        throw new Error(error.message);
      }

      this.logger.log(`Order notification dispatched to ${payload.emails.join(', ')}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to send order notification to ${payload.emails.join(', ')}`, error);
      return { success: false, error: error.message };
    }
  }

  async sendEmail(toEmail: string, subject: string, htmlContent: string) {
    if (this.configService.get<string>('RESEND_API_KEY')?.startsWith('re_mock')) {
      this.logger.log(`[MOCK EMAIL SENT] Email sent to ${toEmail} with subject: ${subject}`);
      return { success: true, mock: true };
    }

    try {
      const { error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: toEmail,
        subject,
        html: htmlContent,
      });

      if (error) {
        throw new Error(error.message);
      }

      this.logger.log(`Generic email dispatched to ${toEmail}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to send generic email to ${toEmail}`, error);
      return { success: false, error: error.message };
    }
  }
}
