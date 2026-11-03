import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ResendService } from '../resend/resend.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Ticket, TicketDocument } from '../schemas/ticket.schema';
import {
  Communication,
  CommunicationDocument,
  CommunicationStatus,
} from '../schemas/communication.schema';
import { Event, EventDocument } from '../schemas/event.schema';
import { Tenant, TenantDocument } from '../schemas/tenant.schema';

const MAX_RECIPIENTS = 5000;
const STALE_SENDING_MS = 15 * 60 * 1000;

@Injectable()
export class CommunicationsService {
  private readonly logger = new Logger(CommunicationsService.name);

  constructor(
    private readonly resendService: ResendService,
    @InjectModel(Ticket.name) private readonly ticketModel: Model<TicketDocument>,
    @InjectModel(Event.name) private readonly eventModel: Model<EventDocument>,
    @InjectModel(Tenant.name) private readonly tenantModel: Model<TenantDocument>,
    @InjectModel(Communication.name)
    private readonly communicationModel: Model<CommunicationDocument>,
  ) {}

  private assertTenant(tenantId?: string) {
    if (!tenantId) {
      throw new BadRequestException(
        'Campaigns must be created from an organizer account linked to an organization',
      );
    }
  }

  /**
   * Allow only a conservative subset of formatting. This prevents an organizer
   * (or a compromised account) from injecting scripts, tracking iframes or
   * spoofed links into mail sent from the platform's own domain.
   */
  private sanitizeMessage(raw: string): string {
    let html = String(raw || '');
    html = html.replace(/<\s*(script|style|iframe|object|embed|form|input|meta|link)[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
    html = html.replace(/<\s*(script|style|iframe|object|embed|form|input|meta|link)[^>]*\/?>/gi, '');
    html = html.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    html = html.replace(/(href|src)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]+)/gi, '$1="#"');
    html = html.replace(/data:text\/html/gi, 'data:text/plain');
    if (html.length > 100_000) {
      throw new BadRequestException('Message is too long (max 100,000 characters)');
    }
    return html;
  }

  private validatePayload(payload: any) {
    if (!payload?.subject || String(payload.subject).trim().length < 3) {
      throw new BadRequestException('Email subject is required');
    }
    if (!payload?.message || String(payload.message).trim().length < 3) {
      throw new BadRequestException('Email message is required');
    }
    if (!['all', 'event', 'custom'].includes(payload.audience)) {
      throw new BadRequestException('Choose a valid audience');
    }
    if (payload.audience === 'event' && !payload.eventId) {
      throw new BadRequestException('Select the event whose attendees you want to email');
    }
  }

  async findAll(tenantId: string, page = 1, limit = 50) {
    this.assertTenant(tenantId);
    page = Math.max(1, Number(page) || 1);
    limit = Math.min(100, Math.max(1, Number(limit) || 50));
    const [data, total] = await Promise.all([
      this.communicationModel
        .find({ tenantId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.communicationModel.countDocuments({ tenantId }),
    ]);
    return {
      data,
      metadata: {
        total,
        page,
        limit,
        lastPage: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async findOne(id: string, tenantId: string) {
    this.assertTenant(tenantId);
    const comm = await this.communicationModel.findOne({ _id: id, tenantId });
    if (!comm) throw new NotFoundException('Communication not found');
    return comm;
  }

  async create(tenantId: string, payload: any) {
    this.assertTenant(tenantId);
    this.validatePayload(payload);
    const comm = await this.communicationModel.create({
      tenantId,
      audience: payload.audience,
      eventId: payload.eventId || undefined,
      customEmails: Array.isArray(payload.customEmails) ? payload.customEmails : [],
      subject: String(payload.subject).trim(),
      message: this.sanitizeMessage(payload.message),
      status: CommunicationStatus.DRAFT,
    });
    return comm;
  }

  async update(id: string, tenantId: string, payload: any) {
    const comm = await this.findOne(id, tenantId);

    if (
      comm.status === CommunicationStatus.SENDING &&
      comm.lastAttemptAt &&
      Date.now() - new Date(comm.lastAttemptAt).getTime() < STALE_SENDING_MS
    ) {
      throw new ConflictException('This campaign is currently sending');
    }

    if (payload.subject !== undefined) {
      if (String(payload.subject).trim().length < 3) {
        throw new BadRequestException('Email subject is required');
      }
      comm.subject = String(payload.subject).trim();
    }
    if (payload.message !== undefined) {
      comm.message = this.sanitizeMessage(payload.message);
    }
    if (payload.audience !== undefined) {
      if (!['all', 'event', 'custom'].includes(payload.audience)) {
        throw new BadRequestException('Choose a valid audience');
      }
      comm.audience = payload.audience;
    }
    if (payload.eventId !== undefined) comm.eventId = payload.eventId || undefined;
    if (payload.customEmails !== undefined) {
      comm.customEmails = Array.isArray(payload.customEmails) ? payload.customEmails : [];
    }
    if (comm.audience === 'event' && !comm.eventId) {
      throw new BadRequestException('Select an event for an event audience');
    }

    return comm.save();
  }

  async delete(id: string, tenantId: string) {
    const comm = await this.findOne(id, tenantId);
    if (
      comm.status === CommunicationStatus.SENDING &&
      comm.lastAttemptAt &&
      Date.now() - new Date(comm.lastAttemptAt).getTime() < STALE_SENDING_MS
    ) {
      throw new ConflictException('This campaign is currently sending');
    }
    await this.communicationModel.deleteOne({ _id: comm._id });
    return { success: true };
  }

  private async resolveRecipients(comm: CommunicationDocument, tenantId: string) {
    const emails = new Set<string>();

    if (comm.audience === 'custom') {
      (comm.customEmails || []).forEach((email) => {
        const clean = String(email).trim().toLowerCase();
        if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean)) emails.add(clean);
      });
    } else if (comm.audience === 'event' && comm.eventId) {
      const event = await this.eventModel.findOne({ _id: comm.eventId, tenantId });
      if (!event) throw new NotFoundException('Event not found');
      const tickets = await this.ticketModel
        .find({ eventId: comm.eventId, tenantId, attendeeEmail: { $exists: true, $ne: null } })
        .select('attendeeEmail')
        .limit(MAX_RECIPIENTS)
        .lean()
        .exec();
      tickets.forEach((t) => {
        const email = String(t.attendeeEmail || '').toLowerCase().trim();
        if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) emails.add(email);
      });
    } else if (comm.audience === 'all') {
      const tickets = await this.ticketModel
        .find({ tenantId, attendeeEmail: { $exists: true, $ne: null } })
        .select('attendeeEmail')
        .limit(MAX_RECIPIENTS)
        .lean()
        .exec();
      tickets.forEach((t) => {
        const email = String(t.attendeeEmail || '').toLowerCase().trim();
        if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) emails.add(email);
      });
    }

    return Array.from(emails);
  }

  async sendCommunication(id: string, tenantId: string, options: { force?: boolean } = {}) {
    const comm = await this.findOne(id, tenantId);

    if (comm.status === CommunicationStatus.SENDING) {
      const startedAt = comm.lastAttemptAt ? new Date(comm.lastAttemptAt).getTime() : 0;
      if (Date.now() - startedAt < STALE_SENDING_MS) {
        throw new ConflictException('This campaign is already being sent');
      }
    }
    if (comm.status === CommunicationStatus.SENT && !options.force) {
      throw new ConflictException(
        'This campaign has already been sent. Duplicate blasts are blocked — duplicate the campaign to send it again.',
      );
    }

    const emailList = await this.resolveRecipients(comm, tenantId);
    if (emailList.length === 0) {
      comm.status = CommunicationStatus.FAILED;
      comm.lastError = 'No valid recipients found';
      comm.lastAttemptAt = new Date();
      await comm.save();
      throw new BadRequestException('No valid recipients were found for this audience');
    }
    if (emailList.length > MAX_RECIPIENTS) {
      throw new BadRequestException(
        `This audience has more than ${MAX_RECIPIENTS} recipients. Narrow it down first.`,
      );
    }

    const tenant = await this.tenantModel.findById(tenantId);
    const brand = tenant?.name || 'Ticketr';
    const brandColor = tenant?.primaryColor || '#0F4D3F';
    const logo = tenant?.logoUrl || 'https://www.ticketr.org/logo.png';

    comm.status = CommunicationStatus.SENDING;
    comm.lastAttemptAt = new Date();
    comm.recipientCount = emailList.length;
    comm.successCount = 0;
    comm.failedCount = 0;
    await comm.save();

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
      <body style="margin:0;background:#f4f5f1;padding:32px 16px;font-family:Inter,-apple-system,Segoe UI,Arial,sans-serif;color:#0b1f1a;line-height:1.65">
        <div style="max-width:620px;margin:0 auto;background:#fff;border-radius:20px;overflow:hidden;border:1px solid #e6e8e1">
          <div style="padding:28px 32px;border-bottom:1px solid #eceee7;display:flex;align-items:center;gap:12px">
            <img src="${logo}" alt="${brand}" style="height:36px;border-radius:8px" />
            <strong style="font-size:16px">${brand}</strong>
          </div>
          <div style="padding:32px">
            ${comm.message}
          </div>
          <div style="padding:22px 32px;background:#fafbf8;border-top:1px solid #eceee7;font-size:12px;color:#7a857f">
            Sent by ${brand} via Ticketr · ${emailList.length} recipients
          </div>
        </div>
      </body>
      </html>`;

    let successCount = 0;
    let failedCount = 0;
    const chunkSize = 20;

    for (let i = 0; i < emailList.length; i += chunkSize) {
      const chunk = emailList.slice(i, i + chunkSize);
      const results = await Promise.allSettled(
        chunk.map((email) => this.resendService.sendEmail(email, comm.subject, htmlContent)),
      );
      for (const result of results) {
        if (result.status === 'fulfilled' && (result.value as any)?.success) successCount++;
        else failedCount++;
      }
      if (i + chunkSize < emailList.length) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    comm.successCount = successCount;
    comm.failedCount = failedCount;
    comm.status =
      failedCount === 0
        ? CommunicationStatus.SENT
        : successCount > 0
          ? CommunicationStatus.SENT
          : CommunicationStatus.FAILED;
    comm.sentAt = new Date();
    comm.lastError =
      failedCount > 0 ? `${failedCount} of ${emailList.length} messages failed` : undefined;
    await comm.save();

    return {
      success: successCount > 0,
      message: `Sent to ${successCount} of ${emailList.length} recipients.`,
      successCount,
      failedCount,
      recipientCount: emailList.length,
    };
  }

  async previewRecipients(id: string, tenantId: string) {
    const comm = await this.findOne(id, tenantId);
    const recipients = await this.resolveRecipients(comm, tenantId);
    return {
      count: recipients.length,
      sample: recipients.slice(0, 5).map((email) => {
        const [name, domain] = email.split('@');
        return `${name.slice(0, 2)}•••@${domain}`;
      }),
    };
  }
}
