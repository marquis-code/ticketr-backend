import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import * as QRCode from 'qrcode';
import { EmailLogService } from '../email-log/email-log.service';
import { EmailStatus } from '../schemas/email-log.schema';

@Injectable()
export class ResendService {
  private readonly logger = new Logger(ResendService.name);
  private resend: Resend;
  private fromEmail: string;

  constructor(
    private configService: ConfigService,
    @Inject(forwardRef(() => EmailLogService)) private emailLogService: EmailLogService,
  ) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    // A mock key silently "succeeds" without sending. In production that means
    // paying customers never receive tickets, so refuse to start.
    if (process.env.NODE_ENV === 'production' && (!apiKey || apiKey.startsWith('re_mock'))) {
      throw new Error('RESEND_API_KEY is required in production (mock mode is disabled)');
    }
    this.resend = new Resend(apiKey || 're_mock');
    this.fromEmail = this.configService.get<string>('RESEND_FROM_EMAIL') || 'Ticketr <tickets@ticketr.org>';
  }

  private escapeHtml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private isMock(): boolean {
    return !!this.configService.get<string>('RESEND_API_KEY')?.startsWith('re_mock');
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
    qrCodeDelivery?: string;
    walletUrl?: string;
  }, options: { skipLog?: boolean } = {}) {
    let logRecord: any;
    try {
      const subject = `Your ticket for ${payload.eventName} — ${payload.ticketNumber}`;
      if (!options.skipLog) {
        logRecord = await this.emailLogService.createLog({
          recipientEmail: payload.toEmail,
          subject,
          status: EmailStatus.PENDING,
          metadata: { type: 'ticket', payload }
        });
      }

      const qrDataUri = await this.generateQRCodeDataUri(payload.qrCodeHash);

      // If we have the composited ticket image, use it as an inline CID image
      const ticketImageCid = payload.ticketImageBuffer ? 'ticket-image' : null;

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f3f4f6; color: #111827; margin: 0; padding: 40px 20px; }
            .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01); border: 1px solid #e5e7eb; }
            .header { background: #ffffff; padding: 40px 30px 20px; text-align: center; border-bottom: 1px solid #f3f4f6; }
            .header img { height: 48px; margin-bottom: 20px; }
            .header h1 { margin: 0; font-size: 24px; font-weight: 800; color: #111827; }
            .header p { margin: 8px 0 0; color: #6b7280; font-size: 15px; }
            .body { padding: 30px; }
            .greeting { font-size: 16px; margin-bottom: 24px; color: #374151; line-height: 1.5; text-align: center; }
            .qr-container { text-align: center; margin: 0 0 30px; padding: 24px; background: #f8fafc; border-radius: 16px; border: 1px dashed #cbd5e1; }
            .qr-container img { width: 220px; height: 220px; margin-bottom: 12px; }
            .qr-container p { margin: 0; font-size: 13px; color: #64748b; font-weight: 500; }
            table.info-table { width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 16px; background: #f9fafb; border-radius: 16px; overflow: hidden; }
            table.info-table td { padding: 16px 20px; vertical-align: middle; border-bottom: 1px solid #f3f4f6; }
            table.info-table tr:last-child td { border-bottom: none; }
            table.info-table td.label { font-size: 12px; text-transform: uppercase; color: #6b7280; font-weight: 700; letter-spacing: 0.5px; width: 35%; background: #f3f4f6; }
            table.info-table td.value { font-size: 15px; font-weight: 600; color: #111827; }
            .footer { text-align: center; padding: 24px; font-size: 13px; color: #9ca3af; background: #f9fafb; }
            .footer a { color: #0F4D3F; text-decoration: none; font-weight: 600; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="header">
              <img src="https://res.cloudinary.com/v6cmhap8/image/upload/v1789751565/logo.png" alt="Ticketr Logo" />
              <h1>🎟️ Your Event Ticket</h1>
              <p>Booking Confirmed</p>
            </div>
            <div class="body">
              <div class="greeting">Hi <strong>${this.escapeHtml(payload.customerName)}</strong>, your ticket for <strong>${this.escapeHtml(payload.eventName)}</strong> is confirmed and ready!</div>
              
              ${payload.qrCodeDelivery !== 'NONE' ? `
              <div class="qr-container">
                <img src="${qrDataUri}" width="220" height="220" alt="Ticket QR Code" />
                <p>Present this QR Code at gate entry</p>
              </div>
              ` : ''}

              <table class="info-table">
                <tr><td class="label">Event</td><td class="value">${this.escapeHtml(payload.eventName)}</td></tr>
                <tr><td class="label">Date</td><td class="value">${this.escapeHtml(payload.eventDate)}</td></tr>
                <tr><td class="label">Venue</td><td class="value">${this.escapeHtml(payload.eventLocation)}</td></tr>
                <tr><td class="label">Ticket Type</td><td class="value">${this.escapeHtml(payload.tierName)}</td></tr>
                <tr><td class="label">Ticket No.</td><td class="value">${this.escapeHtml(payload.ticketNumber)}</td></tr>
              </table>
              ${payload.walletUrl ? `<div style="text-align:center;margin-top:24px">
                <a href="${payload.walletUrl}" style="display:inline-block;background:#0F4D3F;color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:600">Open my ticket wallet</a>
                <p style="font-size:12px;color:#94a3b8;margin-top:10px">This private link is the key to your tickets. Do not forward this email.</p>
              </div>` : ''}
            </div>
            <div class="footer">
              Powered by <strong>Ticketr</strong> | <a href="https://www.ticketr.org">www.ticketr.org</a>
            </div>
          </div>
        </body>
        </html>
      `;

      if (this.isMock()) {
        if (process.env.NODE_ENV === 'production') {
          throw new Error('Email provider is in mock mode — refusing to mark a ticket as delivered');
        }
        this.logger.log(`[MOCK EMAIL] Ticket queued for ${payload.toEmail} (${payload.eventName})`);
        if (logRecord) {
          await this.emailLogService.updateLogStatus(logRecord._id.toString(), EmailStatus.SENT);
        }
        return { success: true, mock: true };
      }

      // Build attachments array
      const attachments: any[] = [];

      if (payload.ticketPdfBuffer) {
        attachments.push({
          filename: `Ticket-${payload.ticketNumber.replace(/[\\/]/g, '-')}.pdf`,
          content: payload.ticketPdfBuffer.toString('base64'),
        });
      }

      if (payload.ticketImageBuffer) {
        attachments.push({
          filename: `ticket-image.png`,
          content: payload.ticketImageBuffer.toString('base64'),
          content_id: ticketImageCid,
        });
      }

      const { error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: payload.toEmail,
        subject,
        html: htmlContent,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      
      if (error) {
        throw new Error(error.message);
      }

      this.logger.log(`Ticket email dispatched to ${payload.toEmail}`);
      if (logRecord) {
        await this.emailLogService.updateLogStatus(logRecord._id.toString(), EmailStatus.SENT);
      }
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to send ticket email to ${payload.toEmail}`, error);
      if (logRecord) {
        await this.emailLogService.updateLogStatus(logRecord._id.toString(), EmailStatus.FAILED, error.message);
      }
      throw error;
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
            body { font-family: 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f3f4f6; color: #111827; margin: 0; padding: 40px 20px; }
            .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01); border: 1px solid #e5e7eb; }
            .header { background: #ffffff; padding: 40px 30px 20px; text-align: center; border-bottom: 1px solid #f3f4f6; }
            .header img { height: 48px; margin-bottom: 20px; }
            .header h1 { margin: 0; font-size: 24px; font-weight: 800; color: #111827; }
            .header p { margin: 8px 0 0; color: #6b7280; font-size: 15px; }
            .body { padding: 30px; }
            .info-row { display: flex; margin-bottom: 12px; border-bottom: 1px solid #f3f4f6; padding-bottom: 12px; align-items: center; }
            .info-row:last-child { border-bottom: none; }
            .label { font-size: 12px; text-transform: uppercase; color: #6b7280; font-weight: 700; letter-spacing: 0.5px; min-width: 130px; }
            .value { font-size: 15px; font-weight: 600; color: #111827; }
            .footer { text-align: center; padding: 24px; font-size: 13px; color: #9ca3af; background: #f9fafb; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="header">
              <img src="https://res.cloudinary.com/v6cmhap8/image/upload/v1789751565/logo.png" alt="Ticketr Logo" />
              <h1>🔔 New Order Received</h1>
              <p>A new payment has been successfully processed</p>
            </div>
            <div class="body">
              <div class="info-row">
                <div class="label">Event</div>
                <div class="value">${this.escapeHtml(payload.eventName)}</div>
              </div>
              <div class="info-row">
                <div class="label">Order No.</div>
                <div class="value">${this.escapeHtml(payload.orderNumber)}</div>
              </div>
              <div class="info-row">
                <div class="label">Customer</div>
                <div class="value">${this.escapeHtml(payload.customerName)} (${this.escapeHtml(payload.customerEmail)})</div>
              </div>
              <div class="info-row">
                <div class="label">Total Paid</div>
                <div class="value" style="color: #059669; font-size: 18px;">₦${payload.totalAmount.toLocaleString()}</div>
              </div>
              <div class="info-row">
                <div class="label">Tickets</div>
                <div class="value" style="white-space: pre-wrap; font-weight: 500;">${this.escapeHtml(payload.ticketDetails)}</div>
              </div>
            </div>
            <div class="footer">
              Ticketr Automated Notification System
            </div>
          </div>
        </body>
        </html>
      `;

      if (this.isMock()) {
        this.logger.log(`[MOCK EMAIL] Admin notification for order ${payload.orderNumber}`);
        return { success: true, mock: true };
      }

      const { error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: payload.emails,
        subject: `New order: ₦${payload.totalAmount.toLocaleString()} — ${payload.eventName}`,
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

  async sendPaymentReminder(payload: {
    toEmail: string;
    customerName: string;
    eventName: string;
    orderNumber: string;
    checkoutUrl: string;
    customSubject?: string;
    customMessage?: string;
  }) {
    try {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f3f4f6; color: #111827; margin: 0; padding: 40px 20px; }
            .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01); border: 1px solid #e5e7eb; }
            .header { background: #ffffff; padding: 40px 30px 20px; text-align: center; border-bottom: 1px solid #f3f4f6; }
            .header img { height: 48px; margin-bottom: 20px; }
            .header h1 { margin: 0; font-size: 24px; font-weight: 800; color: #111827; }
            .header p { margin: 8px 0 0; color: #6b7280; font-size: 15px; }
            .body { padding: 30px; text-align: center; }
            .greeting { font-size: 16px; margin-bottom: 24px; color: #374151; line-height: 1.5; }
            .cta-button { display: inline-block; background-color: #059669; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-weight: 600; font-size: 16px; margin: 20px 0; }
            .footer { text-align: center; padding: 24px; font-size: 13px; color: #9ca3af; background: #f9fafb; }
            .footer a { color: #0F4D3F; text-decoration: none; font-weight: 600; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="header">
              <img src="https://res.cloudinary.com/v6cmhap8/image/upload/v1789751565/logo.png" alt="Ticketr Logo" />
              <h1>Action Required</h1>
              <p>Complete Your Booking</p>
            </div>
            <div class="body">
              <div class="greeting">
                ${payload.customMessage
                  ? this.escapeHtml(payload.customMessage).replace(/\n/g, '<br/>')
                  : `Hi <strong>${this.escapeHtml(payload.customerName)}</strong>,<br/><br/>We noticed you started booking a ticket for <strong>${this.escapeHtml(payload.eventName)}</strong> but didn't finish. Secure your spot now before tickets run out!`}
              </div>
              <a href="${payload.checkoutUrl}" class="cta-button">Complete Payment</a>
              <p style="margin-top: 20px; font-size: 14px; color: #6b7280;">Order No: ${this.escapeHtml(payload.orderNumber)}</p>
            </div>
            <div class="footer">
              Powered by <strong>Ticketr</strong> | <a href="https://www.ticketr.org">www.ticketr.org</a>
            </div>
          </div>
        </body>
        </html>
      `;

      if (this.isMock()) {
        this.logger.log(`[MOCK EMAIL] Reminder queued for order ${payload.orderNumber}`);
        return { success: true, mock: true };
      }

      const { error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: payload.toEmail,
        subject: payload.customSubject || `Complete your booking for ${payload.eventName}`,
        html: htmlContent,
      });
      
      if (error) {
        throw new Error(error.message);
      }

      this.logger.log(`Payment reminder dispatched to ${payload.toEmail}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to send reminder to ${payload.toEmail}`, error);
      return { success: false, error: error.message };
    }
  }

  async sendLoginOTPEmail(toEmail: string, otp: string, customerName: string) {
    try {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f3f4f6; color: #111827; margin: 0; padding: 40px 20px; }
            .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01); border: 1px solid #e5e7eb; }
            .header { background: #ffffff; padding: 40px 30px 20px; text-align: center; border-bottom: 1px solid #f3f4f6; }
            .header img { height: 48px; margin-bottom: 20px; }
            .header h1 { margin: 0; font-size: 24px; font-weight: 800; color: #111827; }
            .header p { margin: 8px 0 0; color: #6b7280; font-size: 15px; }
            .body { padding: 40px 30px; text-align: center; }
            .greeting { font-size: 16px; margin-bottom: 24px; color: #374151; line-height: 1.5; }
            .otp-box { background: #f8fafc; border: 1px dashed #cbd5e1; font-size: 36px; font-weight: 800; letter-spacing: 8px; padding: 24px; border-radius: 16px; margin: 24px 0; color: #0F4D3F; display: inline-block; box-shadow: inset 0 2px 4px 0 rgba(0, 0, 0, 0.02); }
            .footer { text-align: center; padding: 24px; font-size: 13px; color: #9ca3af; background: #f9fafb; border-top: 1px solid #f3f4f6; }
            .footer a { color: #0F4D3F; text-decoration: none; font-weight: 600; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="header">
              <img src="https://res.cloudinary.com/v6cmhap8/image/upload/v1789751565/logo.png" alt="Ticketr Logo" />
              <h1>Secure Login</h1>
              <p>Your One-Time Password</p>
            </div>
            <div class="body">
              <div class="greeting">
                Hi <strong>${customerName}</strong>,<br/><br/>Use the following One-Time Password (OTP) to complete your secure login. It expires in 10 minutes.
              </div>
              <div class="otp-box">${otp}</div>
              <p style="font-size: 13px; color: #64748b; margin-top: 10px;">If you didn't request this code, please ignore this email.</p>
            </div>
            <div class="footer">
              Powered by <strong>Ticketr Admin</strong> | <a href="https://www.ticketr.org">www.ticketr.org</a>
            </div>
          </div>
        </body>
        </html>
      `;

      if (this.isMock()) {
        this.logger.log(`[MOCK EMAIL] Login OTP generated for ${toEmail}`);
        return { success: true, mock: true };
      }

      const { error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: toEmail,
        subject: 'Your Ticketr login verification code',
        html: htmlContent,
      });
      if (error) throw new Error(error.message);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to send OTP to ${toEmail}`, error);
      return { success: false, error: error.message };
    }
  }

  /** Reminder for people who already hold tickets (paid or part-paid). */
  async sendAttendeeReminder(payload: {
    toEmail: string;
    customerName: string;
    eventName: string;
    eventDate: string;
    eventLocation: string;
    subject: string;
    message: string;
  }) {
    const frontend = (process.env.FRONTEND_URL || 'https://ticketr.org').replace(/\/+$/, '');
    const html = `
      <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:auto;background:#F6F5EF;padding:32px 16px;color:#0A1F1A">
        <div style="background:#fff;border:1px solid #E4E4DA;border-radius:20px;overflow:hidden">
          <div style="background:#0A1F1A;color:#F6F5EF;padding:28px 32px">
            <p style="margin:0;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#D8F26B;font-weight:700">Event reminder</p>
            <h1 style="margin:8px 0 0;font-size:24px;line-height:1.2">${this.escapeHtml(payload.eventName)}</h1>
            <p style="margin:8px 0 0;color:rgba(246,245,239,.65);font-size:13px">${this.escapeHtml(payload.eventDate)} · ${this.escapeHtml(payload.eventLocation)}</p>
          </div>
          <div style="padding:28px 32px;font-size:15px;line-height:1.7;color:#37514A">
            <p style="margin:0 0 16px">Hi <strong>${this.escapeHtml(payload.customerName)}</strong>,</p>
            <p style="margin:0">${this.escapeHtml(payload.message).replace(/\n/g, '<br/>')}</p>
            <div style="text-align:center;margin-top:28px">
              <a href="${frontend}/my-tickets" style="display:inline-block;background:#11483A;color:#fff;text-decoration:none;padding:14px 26px;border-radius:12px;font-weight:600">Open my ticket wallet</a>
            </div>
            <p style="margin:22px 0 0;font-size:12px;color:#7A857F">Your QR pass is private to your email. Do not forward it.</p>
          </div>
        </div>
      </div>`;
    if (this.isMock()) {
      this.logger.log(`[MOCK EMAIL] Attendee reminder queued for ${payload.toEmail}`);
      return { success: true, mock: true };
    }
    try {
      const { error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: payload.toEmail,
        subject: payload.subject,
        html,
      });
      if (error) throw new Error(error.message);
      return { success: true };
    } catch (error: any) {
      this.logger.error(`Attendee reminder failed for ${payload.toEmail}`, error);
      return { success: false, error: error?.message };
    }
  }

  async sendRefundEmail(payload: {
    toEmail: string;
    customerName: string;
    eventName: string;
    orderNumber: string;
    amount: number;
    reason: string;
    reference: string;
  }) {
    const html = `
      <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:auto;background:#F6F5EF;padding:32px 16px;color:#0A1F1A">
        <div style="background:#fff;border:1px solid #E4E4DA;border-radius:20px;overflow:hidden">
          <div style="background:#0A1F1A;color:#F6F5EF;padding:28px 32px">
            <p style="margin:0;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#D8F26B;font-weight:700">Refund processed</p>
            <h1 style="margin:8px 0 0;font-size:24px;line-height:1.2">₦${payload.amount.toLocaleString()}</h1>
          </div>
          <div style="padding:28px 32px;font-size:15px;line-height:1.7;color:#37514A">
            <p style="margin:0 0 16px">Hi <strong>${this.escapeHtml(payload.customerName)}</strong>,</p>
            <p style="margin:0 0 16px">We refunded <strong>₦${payload.amount.toLocaleString()}</strong> for <strong>${this.escapeHtml(payload.eventName)}</strong> (order ${this.escapeHtml(payload.orderNumber)}).</p>
            <p style="margin:0 0 16px"><strong>Reason:</strong> ${this.escapeHtml(payload.reason)}</p>
            <p style="margin:0 0 16px"><strong>Refund reference:</strong> <span style="font-family:monospace">${this.escapeHtml(payload.reference)}</span></p>
            <p style="margin:0;color:#7A857F;font-size:12px">Card refunds usually appear within 5–10 business days depending on your bank. Tickets attached to this order have been cancelled and will not admit entry.</p>
          </div>
          <div style="padding:20px 32px;background:#FAFBF8;border-top:1px solid #ECEEE7;font-size:12px;color:#7A857F">
            Questions? Reply to this email or contact support@ticketr.org.
          </div>
        </div>
      </div>`;
    if (this.isMock()) {
      this.logger.log(`[MOCK EMAIL] Refund notification queued for ${payload.toEmail}`);
      return { success: true, mock: true };
    }
    try {
      const { error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: payload.toEmail,
        subject: `Refund processed — ${payload.eventName}`,
        html,
      });
      if (error) throw new Error(error.message);
      return { success: true };
    } catch (error: any) {
      this.logger.error(`Refund email failed for ${payload.toEmail}`, error);
      return { success: false, error: error?.message };
    }
  }

  async sendPasswordResetEmail(toEmail: string, resetLink: string, customerName: string) {
    try {
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f3f4f6; color: #111827; margin: 0; padding: 40px 20px; }
            .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01); border: 1px solid #e5e7eb; }
            .header { background: #ffffff; padding: 40px 30px 20px; text-align: center; border-bottom: 1px solid #f3f4f6; }
            .header img { height: 48px; margin-bottom: 20px; }
            .header h1 { margin: 0; font-size: 24px; font-weight: 800; color: #111827; }
            .header p { margin: 8px 0 0; color: #6b7280; font-size: 15px; }
            .body { padding: 40px 30px; text-align: center; }
            .greeting { font-size: 16px; margin-bottom: 24px; color: #374151; line-height: 1.5; }
            .cta-button { display: inline-block; background-color: #0F4D3F; color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 12px; font-weight: 600; font-size: 16px; margin: 24px 0; transition: background-color 0.2s; box-shadow: 0 4px 6px -1px rgba(15, 77, 63, 0.2); }
            .cta-button:hover { background-color: #0d4034; }
            .footer { text-align: center; padding: 24px; font-size: 13px; color: #9ca3af; background: #f9fafb; border-top: 1px solid #f3f4f6; }
            .footer a { color: #0F4D3F; text-decoration: none; font-weight: 600; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="header">
              <img src="https://res.cloudinary.com/v6cmhap8/image/upload/v1789751565/logo.png" alt="Ticketr Logo" />
              <h1>Reset Password</h1>
              <p>Secure Account Recovery</p>
            </div>
            <div class="body">
              <div class="greeting">
                Hi <strong>${customerName}</strong>,<br/><br/>We received a request to reset the password for your Ticketr account.
              </div>
              <a href="${resetLink}" class="cta-button">Set New Password</a>
              <p style="font-size: 13px; color: #64748b; margin-top: 20px;">This link will expire in 1 hour.<br/>If you didn't request this, you can safely ignore this email.</p>
            </div>
            <div class="footer">
              Powered by <strong>Ticketr Admin</strong> | <a href="https://www.ticketr.org">www.ticketr.org</a>
            </div>
          </div>
        </body>
        </html>
      `;

      if (this.isMock()) {
        this.logger.log(`[MOCK EMAIL] Password reset link generated for ${toEmail}`);
        return { success: true, mock: true };
      }

      const { error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: toEmail,
        subject: `Reset your Ticketr Password`,
        html: htmlContent,
      });
      if (error) throw new Error(error.message);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to send password reset to ${toEmail}`, error);
      return { success: false, error: error.message };
    }
  }

  async sendEmail(toEmail: string, subject: string, htmlContent: string) {
    if (this.isMock()) {
      this.logger.log(`[MOCK EMAIL] Campaign email for ${toEmail} (${subject})`);
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
