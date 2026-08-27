import { Injectable, Logger } from '@nestjs/common';
import { ResendService } from '../resend/resend.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TicketDocument } from '../schemas/ticket.schema';

@Injectable()
export class CommunicationsService {
  private readonly logger = new Logger(CommunicationsService.name);

  constructor(
    private readonly resendService: ResendService,
    @InjectModel('Ticket') private readonly ticketModel: Model<TicketDocument>,
  ) {}

  async broadcastEmail(payload: {
    tenantId: string;
    audience: string;
    eventId?: string;
    customEmails?: string[];
    subject: string;
    message: string;
  }) {
    let targetEmails = new Set<string>();

    if (payload.audience === 'custom' && payload.customEmails && payload.customEmails.length > 0) {
      payload.customEmails.forEach(e => targetEmails.add(e.trim().toLowerCase()));
    } else if (payload.audience === 'event' && payload.eventId) {
      const tickets = await this.ticketModel.find({ eventId: payload.eventId, tenantId: payload.tenantId });
      tickets.forEach(t => {
        if (t.attendeeEmail) targetEmails.add(t.attendeeEmail.toLowerCase());
      });
    } else if (payload.audience === 'all') {
      const tickets = await this.ticketModel.find({ tenantId: payload.tenantId });
      tickets.forEach(t => {
        if (t.attendeeEmail) targetEmails.add(t.attendeeEmail.toLowerCase());
      });
    }

    const emailList = Array.from(targetEmails).filter(e => e.includes('@'));

    if (emailList.length === 0) {
      return { success: false, message: 'No valid recipients found.' };
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: 'Inter', sans-serif; background-color: #f3f4f6; padding: 40px 20px; color: #111827; line-height: 1.6; }
          .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 30px; border: 1px solid #e5e7eb; }
          .footer { margin-top: 30px; font-size: 13px; color: #6b7280; text-align: center; }
        </style>
      </head>
      <body>
        <div class="card">
          ${payload.message.replace(/\n/g, '<br/>')}
        </div>
        <div class="footer">
          Powered by Ticketr Admin
        </div>
      </body>
      </html>
    `;

    let successCount = 0;
    let failedCount = 0;

    const chunkSize = 10;
    for (let i = 0; i < emailList.length; i += chunkSize) {
      const chunk = emailList.slice(i, i + chunkSize);
      await Promise.allSettled(chunk.map(async (email) => {
        try {
          const res = await this.resendService.sendEmail(email, payload.subject, htmlContent);
          if (res.success) successCount++;
          else failedCount++;
        } catch (e) {
          failedCount++;
        }
      }));
    }

    return { success: true, message: `Dispatched emails to ${emailList.length} recipients.`, successCount, failedCount };
  }
}
