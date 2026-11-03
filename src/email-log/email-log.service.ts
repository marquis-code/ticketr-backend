import { Injectable, Logger, Inject, forwardRef, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EmailLog, EmailStatus } from '../schemas/email-log.schema';
import { ResendService } from '../resend/resend.service';

@Injectable()
export class EmailLogService {
  private readonly logger = new Logger(EmailLogService.name);

  constructor(
    @InjectModel(EmailLog.name) private emailLogModel: Model<EmailLog>,
    @Inject(forwardRef(() => ResendService)) private resendService: ResendService,
  ) {}

  async createLog(data: Partial<EmailLog>) {
    return this.emailLogModel.create(data);
  }

  async updateLogStatus(id: string, status: EmailStatus, errorReason?: string) {
    const update: any = {
      $set: { status, errorReason: status === EmailStatus.SENT ? undefined : errorReason },
    };
    if (status === EmailStatus.FAILED) update.$inc = { retryCount: 1 };
    return this.emailLogModel.findByIdAndUpdate(id, update, { new: true });
  }

  async getLogs(page: number = 1, limit: number = 20) {
    page = Math.max(1, Number(page) || 1);
    limit = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.emailLogModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.emailLogModel.countDocuments(),
    ]);
    return {
      data,
      meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  @Cron('0 */15 * * * *')
  async handleFailedEmailsCron() {
    this.logger.log('Running cron job to retry failed emails...');
    const failedLogs = await this.emailLogModel
      .find({
        status: EmailStatus.FAILED,
        retryCount: { $lt: 3 },
        'metadata.type': 'ticket',
      })
      .limit(50);

    for (const log of failedLogs) {
      try {
        await this.retryEmail(log._id.toString());
      } catch (err) {
        this.logger.error(`Retry failed for email log ${log._id}`, err as any);
      }
    }
  }

  async retryEmail(logId: string) {
    if (!Types.ObjectId.isValid(logId)) {
      throw new NotFoundException('Email log not found');
    }

    // Atomic claim: only one worker can retry a given log, and attempts are
    // capped so a permanently failing address cannot loop forever.
    const log = await this.emailLogModel.findOneAndUpdate(
      {
        _id: logId,
        status: { $in: [EmailStatus.FAILED, EmailStatus.PENDING] },
        retryCount: { $lt: 3 },
        'metadata.type': 'ticket',
      },
      { $inc: { retryCount: 1 }, $set: { status: EmailStatus.PENDING } },
      { new: true },
    );

    if (!log) {
      const existing = await this.emailLogModel.findById(logId);
      if (!existing) throw new NotFoundException('Email log not found');
      throw new BadRequestException(
        'This email cannot be retried (unsupported type or retry limit reached)',
      );
    }

    try {
      // skipLog prevents creating a brand-new EmailLog for every retry attempt.
      await this.resendService.sendTicketEmail((log.metadata as any).payload, { skipLog: true });
      log.status = EmailStatus.SENT;
      log.errorReason = undefined;
    } catch (e: any) {
      log.status = EmailStatus.FAILED;
      log.errorReason = e?.message || 'Unknown delivery error';
    }
    await log.save();
    return log;
  }
}
