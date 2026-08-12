import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditLog, AuditLogDocument } from '../schemas/audit-log.schema';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(AuditLog.name) private auditLogModel: Model<AuditLogDocument>,
  ) {}

  async logAction(dto: {
    action: string;
    entity: string;
    entityId: string;
    userId: string;
    tenantId: string;
    details?: any;
    ipAddress?: string;
  }) {
    try {
      await this.auditLogModel.create(dto);
      this.logger.log(`Audit: ${dto.action} on ${dto.entity} ${dto.entityId} by user ${dto.userId}`);
    } catch (error) {
      this.logger.error('Failed to create audit log', error);
    }
  }

  async getLogsForTenant(
    tenantId: string, 
    page = 1, 
    limit = 50, 
    filters?: { userId?: string, action?: string, entity?: string, startDate?: string, endDate?: string }
  ) {
    const skip = (page - 1) * limit;
    const query: any = { tenantId };
    
    if (filters?.userId) query.userId = filters.userId;
    if (filters?.action) query.action = filters.action;
    if (filters?.entity) query.entity = filters.entity;
    
    if (filters?.startDate || filters?.endDate) {
      query.createdAt = {};
      if (filters.startDate) query.createdAt.$gte = new Date(filters.startDate);
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    const [logs, total] = await Promise.all([
      this.auditLogModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'name email role')
        .exec(),
      this.auditLogModel.countDocuments(query)
    ]);
    return { logs, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
