import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Payout, PayoutDocument, PayoutStatus } from '../schemas/payout.schema';
import { Order, OrderDocument, OrderStatus } from '../schemas/order.schema';
import { Tenant, TenantDocument } from '../schemas/tenant.schema';

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    @InjectModel(Payout.name) private payoutModel: Model<PayoutDocument>,
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(Tenant.name) private tenantModel: Model<TenantDocument>,
  ) {}

  private orderNet(order: any): number {
    if (typeof order.netToOrganizer === 'number') return order.netToOrganizer;
    return Math.max(0, (order.totalAmount || 0) - (order.platformFee || 0));
  }

  private async availableOrders(tenantId: string) {
    return this.orderModel
      .find({
        tenantId,
        status: OrderStatus.PAID,
        channel: { $ne: 'RESALE' },
        payoutId: { $exists: false },
        refundedAt: { $exists: false },
        $or: [
          { netToOrganizer: { $gt: 0 } },
          { netToOrganizer: { $exists: false }, totalAmount: { $gt: 0 } },
        ],
      })
      .sort({ createdAt: 1 })
      .select('_id netToOrganizer totalAmount platformFee createdAt')
      .lean()
      .exec();
  }

  async getSummary(tenantId: string) {
    const [orders, pendingAgg, paidAgg, lastPayout] = await Promise.all([
      this.availableOrders(tenantId),
      this.payoutModel.aggregate([
        {
          $match: {
            tenantId: new Types.ObjectId(tenantId),
            status: { $in: [PayoutStatus.PENDING, PayoutStatus.PROCESSING] },
          },
        },
        { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      this.payoutModel.aggregate([
        { $match: { tenantId: new Types.ObjectId(tenantId), status: PayoutStatus.PAID } },
        { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      this.payoutModel
        .findOne({ tenantId, status: PayoutStatus.PAID })
        .sort({ paidAt: -1 })
        .lean()
        .exec(),
    ]);

    const available =
      Math.round(orders.reduce((sum, order) => sum + this.orderNet(order), 0) * 100) / 100;

    return {
      availableBalance: available,
      availableOrders: orders.length,
      pendingPayoutAmount: pendingAgg[0]?.amount || 0,
      pendingPayoutCount: pendingAgg[0]?.count || 0,
      paidTotal: paidAgg[0]?.amount || 0,
      paidCount: paidAgg[0]?.count || 0,
      lastPayout: lastPayout
        ? {
            id: lastPayout._id.toString(),
            amount: lastPayout.amount,
            paidAt: lastPayout.paidAt,
            reference: lastPayout.reference,
          }
        : null,
      currency: 'NGN',
    };
  }

  async listForTenant(tenantId: string, page = 1, limit = 20) {
    page = Math.max(1, Number(page) || 1);
    limit = Math.min(100, Math.max(1, Number(limit) || 20));
    const [data, total] = await Promise.all([
      this.payoutModel
        .find({ tenantId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.payoutModel.countDocuments({ tenantId }),
    ]);
    return {
      data,
      metadata: { total, page, limit, lastPage: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  async getPlatformSummary() {
    const rows = await this.payoutModel.aggregate([
      { $group: { _id: '$status', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);
    const byStatus = new Map(rows.map((row) => [row._id, row]));
    const pending = byStatus.get(PayoutStatus.PENDING) || { amount: 0, count: 0 };
    const processing = byStatus.get(PayoutStatus.PROCESSING) || { amount: 0, count: 0 };
    const paid = byStatus.get(PayoutStatus.PAID) || { amount: 0, count: 0 };
    return {
      pendingAmount: (pending.amount || 0) + (processing.amount || 0),
      pendingCount: (pending.count || 0) + (processing.count || 0),
      paidAmount: paid.amount || 0,
      paidCount: paid.count || 0,
      currency: 'NGN',
    };
  }

  async listAll(page = 1, limit = 50, status?: string) {
    page = Math.max(1, Number(page) || 1);
    limit = Math.min(200, Math.max(1, Number(limit) || 50));
    const filter: any = {};
    if (status && status !== 'ALL') filter.status = status;
    const [data, total] = await Promise.all([
      this.payoutModel
        .find(filter)
        .populate('tenantId', 'name slug status logoUrl')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.payoutModel.countDocuments(filter),
    ]);
    return {
      data,
      metadata: { total, page, limit, lastPage: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  async requestPayout(tenantId: string, userId: string) {
    const orders = await this.availableOrders(tenantId);
    if (!orders.length) {
      throw new BadRequestException('There is no settled revenue available for payout yet');
    }
    const tenant = await this.tenantModel.findById(tenantId);
    if (!tenant) throw new NotFoundException('Organization not found');

    const placeholder = await this.payoutModel.create({
      tenantId,
      amount: 0,
      currency: 'NGN',
      status: PayoutStatus.PENDING,
      orderCount: 0,
      orderIds: [],
      requestedBy: userId,
    });

    let amount = 0;
    const claimed: string[] = [];
    const claimedDates: number[] = [];
    for (const order of orders) {
      const claimedOrder = await this.orderModel.findOneAndUpdate(
        {
          _id: order._id,
          payoutId: { $exists: false },
          status: OrderStatus.PAID,
        },
        { $set: { payoutId: placeholder._id.toString() } },
        { new: true },
      );
      if (claimedOrder) {
        amount += this.orderNet(order);
        claimed.push(order._id.toString());
        if ((order as any).createdAt) {
          claimedDates.push(new Date((order as any).createdAt).getTime());
        }
      }
    }

    if (!claimed.length) {
      await this.payoutModel.deleteOne({ _id: placeholder._id });
      throw new BadRequestException('Those orders are already part of another payout');
    }

    placeholder.amount = Math.round(amount * 100) / 100;
    placeholder.orderCount = claimed.length;
    placeholder.orderIds = claimed;
    if (claimedDates.length) {
      placeholder.periodStart = new Date(Math.min(...claimedDates));
    }
    placeholder.periodEnd = new Date();
    await placeholder.save();
    this.logger.log(`Payout ${placeholder._id} requested for tenant ${tenantId}`);
    return placeholder;
  }

  async getOne(id: string, tenantId?: string) {
    const filter: any = { _id: id };
    if (tenantId) filter.tenantId = tenantId;
    const payout = await this.payoutModel.findOne(filter);
    if (!payout) throw new NotFoundException('Payout not found');
    return payout;
  }

  private assertTransition(from: PayoutStatus, to: PayoutStatus) {
    if (from === PayoutStatus.PAID) {
      throw new BadRequestException('A paid payout cannot be changed');
    }
    if (from === PayoutStatus.CANCELLED || from === PayoutStatus.FAILED) {
      throw new BadRequestException('This payout is already closed');
    }
    const allowed: Record<PayoutStatus, PayoutStatus[]> = {
      [PayoutStatus.PENDING]: [
        PayoutStatus.PROCESSING,
        PayoutStatus.PAID,
        PayoutStatus.FAILED,
        PayoutStatus.CANCELLED,
      ],
      [PayoutStatus.PROCESSING]: [PayoutStatus.PAID, PayoutStatus.FAILED, PayoutStatus.CANCELLED],
      [PayoutStatus.PAID]: [],
      [PayoutStatus.FAILED]: [],
      [PayoutStatus.CANCELLED]: [],
    };
    if (!allowed[from]?.includes(to)) {
      throw new BadRequestException(`Cannot move a ${from} payout to ${to}`);
    }
  }

  async updateStatus(
    id: string,
    status: PayoutStatus,
    actor: { userId: string; role: string; tenantId?: string },
    dto: { reference?: string; note?: string; failureReason?: string } = {},
  ) {
    const isSuperAdmin = actor.role === 'SUPER_ADMIN';
    const payout = await this.getOne(id, isSuperAdmin ? undefined : actor.tenantId);
    if (!Object.values(PayoutStatus).includes(status)) {
      throw new BadRequestException('Invalid payout status');
    }
    if (!isSuperAdmin && status !== PayoutStatus.CANCELLED) {
      throw new ForbiddenException('Only Ticketr staff can settle payouts');
    }
    this.assertTransition(payout.status, status);

    payout.status = status;
    payout.processedBy = actor.userId;
    if (dto.reference) payout.reference = dto.reference;
    if (dto.note) payout.note = dto.note;
    if (status === PayoutStatus.PAID) {
      if (!dto.reference?.trim()) {
        throw new BadRequestException('A bank transfer reference is required to mark a payout paid');
      }
      payout.paidAt = new Date();
    }
    if (status === PayoutStatus.FAILED || status === PayoutStatus.CANCELLED) {
      payout.failureReason = dto.failureReason || dto.note || `Marked ${status.toLowerCase()}`;
      await this.orderModel.updateMany(
        { _id: { $in: payout.orderIds } },
        { $unset: { payoutId: '' } },
      );
    }
    if (status === PayoutStatus.PAID) {
      await this.orderModel.updateMany(
        { _id: { $in: payout.orderIds } },
        { $set: { paidOutAt: new Date() } },
      );
    }
    await payout.save();
    return payout;
  }
}
