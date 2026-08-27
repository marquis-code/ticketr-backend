import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ResendService } from '../resend/resend.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TicketDocument } from '../schemas/ticket.schema';
import { CommunicationDocument, CommunicationStatus } from '../schemas/communication.schema';

@Injectable()
export class CommunicationsService {
  private readonly logger = new Logger(CommunicationsService.name);

  constructor(
    private readonly resendService: ResendService,
    @InjectModel('Ticket') private readonly ticketModel: Model<TicketDocument>,
    @InjectModel('Communication') private readonly communicationModel: Model<CommunicationDocument>,
  ) {}

  async findAll(tenantId: string) {
    return this.communicationModel.find({ tenantId }).sort({ createdAt: -1 });
  }

  async findOne(id: string, tenantId: string) {
    const comm = await this.communicationModel.findOne({ _id: id, tenantId });
    if (!comm) throw new NotFoundException('Communication not found');
    return comm;
  }

  async create(tenantId: string, payload: any) {
    const comm = new this.communicationModel({
      tenantId,
      audience: payload.audience,
      eventId: payload.eventId,
      customEmails: payload.customEmails || [],
      subject: payload.subject,
      message: payload.message,
      status: CommunicationStatus.DRAFT
    });
    return comm.save();
  }

  async update(id: string, tenantId: string, payload: any) {
    const comm = await this.findOne(id, tenantId);
    if (comm.status === CommunicationStatus.SENDING) {
      throw new Error('Cannot edit a communication while it is sending.');
    }
    
    comm.audience = payload.audience || comm.audience;
    comm.eventId = payload.eventId || comm.eventId;
    comm.customEmails = payload.customEmails || comm.customEmails;
    comm.subject = payload.subject || comm.subject;
    comm.message = payload.message || comm.message;
    
    return comm.save();
  }

  async delete(id: string, tenantId: string) {
    const comm = await this.findOne(id, tenantId);
    if (comm.status === CommunicationStatus.SENDING) {
      throw new Error('Cannot delete a communication while it is sending.');
    }
    await this.communicationModel.deleteOne({ _id: id });
    return { success: true };
  }

  async sendCommunication(id: string, tenantId: string) {
    const comm = await this.findOne(id, tenantId);
    
    comm.status = CommunicationStatus.SENDING;
    await comm.save();

    let targetEmails = new Set<string>();

    if (comm.audience === 'custom' && comm.customEmails && comm.customEmails.length > 0) {
      comm.customEmails.forEach(e => targetEmails.add(e.trim().toLowerCase()));
    } else if (comm.audience === 'event' && comm.eventId) {
      const tickets = await this.ticketModel.find({ eventId: comm.eventId, tenantId });
      tickets.forEach(t => {
        if (t.attendeeEmail) targetEmails.add(t.attendeeEmail.toLowerCase());
      });
    } else if (comm.audience === 'all') {
      const tickets = await this.ticketModel.find({ tenantId });
      tickets.forEach(t => {
        if (t.attendeeEmail) targetEmails.add(t.attendeeEmail.toLowerCase());
      });
    }

    const emailList = Array.from(targetEmails).filter(e => e.includes('@'));

    if (emailList.length === 0) {
      comm.status = CommunicationStatus.FAILED;
      await comm.save();
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
          ${comm.message}
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
          const res = await this.resendService.sendEmail(email, comm.subject, htmlContent);
          if (res.success) successCount++;
          else failedCount++;
        } catch (e) {
          failedCount++;
        }
      }));
    }

    comm.status = successCount > 0 ? CommunicationStatus.SENT : CommunicationStatus.FAILED;
    await comm.save();

    return { 
      success: true, 
      message: `Dispatched emails to ${emailList.length} recipients.`, 
      successCount, 
      failedCount 
    };
  }
}
