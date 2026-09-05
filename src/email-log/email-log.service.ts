import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
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
    return this.emailLogModel.findByIdAndUpdate(
      id,
      { status, errorReason, ...(status === EmailStatus.FAILED ? { $inc: { retryCount: 1 } } : {}) },
      { new: true }
    );
  }

  async getLogs(page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.emailLogModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.emailLogModel.countDocuments(),
    ]);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  @Cron('0 */15 * * * *')
  async handleFailedEmailsCron() {
    this.logger.log('Running cron job to retry failed emails...');
    const failedLogs = await this.emailLogModel.find({
      status: EmailStatus.FAILED,
      retryCount: { $lt: 3 }
    });

    for (const log of failedLogs) {
      await this.retryEmail(log._id.toString());
    }
  }

  async retryEmail(logId: string) {
    const log = await this.emailLogModel.findById(logId);
    if (!log) throw new Error('Email log not found');

    if (log.metadata && log.metadata.type === 'ticket') {
      try {
        await this.resendService.sendTicketEmail(log.metadata.payload);
        log.status = EmailStatus.SENT;
        log.errorReason = undefined;
      } catch (e) {
        log.status = EmailStatus.FAILED;
        log.errorReason = e.message;
        log.retryCount += 1;
      }
      await log.save();
    }
    
    return log;
  }
}
