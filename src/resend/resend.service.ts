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
              <img src="https://res.cloudinary.com/marquis/image/upload/v1786452024/ticketr_djxoz9.png" alt="Ticketr Logo" />
              <h1>🎟️ Your Event Ticket</h1>
              <p>Booking Confirmed</p>
            </div>
            <div class="body">
              <div class="greeting">Hi <strong>${payload.customerName}</strong>, your ticket for <strong>${payload.eventName}</strong> is confirmed and ready!</div>
              
              <div class="qr-container">
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(payload.qrCodeHash)}" alt="Ticket QR Code" />
                <p>Present this QR Code at gate entry</p>
              </div>

              <table class="info-table">
                <tr><td class="label">Event</td><td class="value">${payload.eventName}</td></tr>
                <tr><td class="label">Date</td><td class="value">${payload.eventDate}</td></tr>
                <tr><td class="label">Venue</td><td class="value">${payload.eventLocation}</td></tr>
                <tr><td class="label">Ticket Type</td><td class="value">${payload.tierName}</td></tr>
                <tr><td class="label">Ticket No.</td><td class="value">${payload.ticketNumber}</td></tr>
              </table>
            </div>
            <div class="footer">
              Powered by <strong>Ticketr</strong> | <a href="https://www.ticketr.org">www.ticketr.org</a>
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
              <img src="https://res.cloudinary.com/marquis/image/upload/v1786452024/ticketr_djxoz9.png" alt="Ticketr Logo" />
              <h1>🔔 New Order Received</h1>
              <p>A new payment has been successfully processed</p>
            </div>
            <div class="body">
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
                <div class="value" style="color: #059669; font-size: 18px;">₦${payload.totalAmount.toLocaleString()}</div>
              </div>
              <div class="info-row">
                <div class="label">Tickets</div>
                <div class="value" style="white-space: pre-wrap; font-weight: 500;">${payload.ticketDetails}</div>
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
              <img src="https://res.cloudinary.com/marquis/image/upload/v1786452024/ticketr_djxoz9.png" alt="Ticketr Logo" />
              <h1>Action Required</h1>
              <p>Complete Your Booking</p>
            </div>
            <div class="body">
              <div class="greeting">
                ${payload.customMessage 
                  ? payload.customMessage 
                  : `Hi <strong>${payload.customerName}</strong>,<br/><br/>We noticed you started booking a ticket for <strong>${payload.eventName}</strong> but didn't finish. Secure your spot now before tickets run out!`}
              </div>
              <a href="${payload.checkoutUrl}" class="cta-button">Complete Payment</a>
              <p style="margin-top: 20px; font-size: 14px; color: #6b7280;">Order No: ${payload.orderNumber}</p>
            </div>
            <div class="footer">
              Powered by <strong>Ticketr</strong> | <a href="https://www.ticketr.org">www.ticketr.org</a>
            </div>
          </div>
        </body>
        </html>
      `;

      if (this.configService.get<string>('RESEND_API_KEY')?.startsWith('re_mock')) {
        this.logger.log(`[MOCK EMAIL SENT] Reminder sent to ${payload.toEmail} for order ${payload.orderNumber}`);
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
              <img src="https://res.cloudinary.com/marquis/image/upload/v1786452024/ticketr_djxoz9.png" alt="Ticketr Logo" />
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

      if (this.configService.get<string>('RESEND_API_KEY')?.startsWith('re_mock')) {
        this.logger.log(`[MOCK EMAIL SENT] OTP sent to ${toEmail}: ${otp}`);
        return { success: true, mock: true };
      }

      const { error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: toEmail,
        subject: `Your Ticketr Login OTP: ${otp}`,
        html: htmlContent,
      });
      if (error) throw new Error(error.message);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to send OTP to ${toEmail}`, error);
      return { success: false, error: error.message };
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
              <img src="https://res.cloudinary.com/marquis/image/upload/v1786452024/ticketr_djxoz9.png" alt="Ticketr Logo" />
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

      if (this.configService.get<string>('RESEND_API_KEY')?.startsWith('re_mock')) {
        this.logger.log(`[MOCK EMAIL SENT] Reset link sent to ${toEmail}: ${resetLink}`);
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
