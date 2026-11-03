import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order, OrderDocument, OrderStatus } from '../schemas/order.schema';
import { Ticket, TicketDocument, TicketStatus } from '../schemas/ticket.schema';
import { Event, EventDocument, EventStatus } from '../schemas/event.schema';
import { Tenant, TenantDocument, TenantStatus } from '../schemas/tenant.schema';
import { TicketTier, TicketTierDocument } from '../schemas/ticket-tier.schema';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(Ticket.name) private ticketModel: Model<TicketDocument>,
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    @InjectModel(Tenant.name) private tenantModel: Model<TenantDocument>,
    @InjectModel(TicketTier.name) private ticketTierModel: Model<TicketTierDocument>,
  ) {}

  async resolveTenantIdFromSubdomain(subdomain: string): Promise<string | null> {
    if (!subdomain) return null;
    const tenant = await this.tenantModel
      .findOne({
        $or: [
          { slug: subdomain.toLowerCase() },
          { customDomain: subdomain.toLowerCase() },
        ],
      })
      .select('_id')
      .lean()
      .exec();
    return tenant ? tenant._id.toString() : null;
  }

  private async tenantScope(tenantId: string) {
    const tid = new Types.ObjectId(tenantId);
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      revenueAgg,
      ticketAgg,
      eventsAgg,
      activeEvents,
      pendingAgg,
      salesOverTime,
      ticketByEvent,
      tierMix,
      departments,
      recentOrders,
      checkInVelocity,
      platformFeeAgg,
      refundAgg,
    ] = await Promise.all([
      this.orderModel.aggregate([
        { $match: { tenantId: tid, status: OrderStatus.PAID, channel: { $ne: 'RESALE' } } },
        {
          $group: {
            _id: null,
            grossRevenue: { $sum: '$totalAmount' },
            orders: { $sum: 1 },
            fees: { $sum: { $ifNull: ['$platformFee', 0] } },
          },
        },
      ]),
      this.ticketModel.aggregate([
        { $match: { tenantId: tid, status: { $ne: TicketStatus.CANCELLED } } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
          },
        },
      ]),
      this.eventModel.aggregate([
        { $match: { tenantId: tid } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      this.eventModel.countDocuments({ tenantId: tid, status: EventStatus.PUBLISHED }),
      this.orderModel.aggregate([
        {
          $match: {
            tenantId: tid,
            status: {
              $in: [OrderStatus.PENDING, OrderStatus.AWAITING_APPROVAL, OrderStatus.PARTIALLY_PAID],
            },
          },
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            amount: { $sum: '$amountRemaining' },
          },
        },
      ]),
      this.orderModel.aggregate([
        {
          $match: {
            tenantId: tid,
            status: OrderStatus.PAID,
            channel: { $ne: 'RESALE' },
            createdAt: { $gte: thirtyDaysAgo },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            revenue: { $sum: '$totalAmount' },
            orders: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      this.eventModel
        .find({ tenantId: tid })
        .select('_id title')
        .lean()
        .exec(),
      this.ticketModel.aggregate([
        { $match: { tenantId: tid, status: { $ne: TicketStatus.CANCELLED } } },
        {
          $lookup: {
            from: 'tickettiers',
            localField: 'tierId',
            foreignField: '_id',
            as: 'tier',
          },
        },
        { $unwind: { path: '$tier', preserveNullAndEmptyArrays: true } },
        { $group: { _id: { $ifNull: ['$tier.name', 'Standard'] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),
      this.ticketModel.aggregate([
        { $match: { tenantId: tid, status: { $ne: TicketStatus.CANCELLED } } },
        { $group: { _id: { $ifNull: ['$departmentCode', 'Unspecified'] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),
      this.orderModel
        .find({ tenantId: tid, channel: { $ne: 'RESALE' } })
        .populate('eventId', 'title startDate')
        .sort({ createdAt: -1 })
        .limit(8)
        .lean()
        .exec(),
      this.ticketModel.aggregate([
        {
          $match: {
            tenantId: tid,
            status: TicketStatus.CHECKED_IN,
            checkedInAt: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%dT%H:00', date: '$checkedInAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      this.orderModel.aggregate([
        { $match: { tenantId: tid, status: OrderStatus.PAID, channel: { $ne: 'RESALE' } } },
        { $group: { _id: null, fees: { $sum: { $ifNull: ['$platformFee', 0] } } } },
      ]),
      this.orderModel.aggregate([
        { $match: { tenantId: tid, status: OrderStatus.REFUNDED } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            amount: { $sum: { $ifNull: ['$refundAmount', '$amountPaid'] } },
          },
        },
      ]),
    ]);

    const revenue = revenueAgg[0] || { grossRevenue: 0, orders: 0, fees: 0 };
    const totalTicketsSold = ticketAgg.reduce((sum, row) => sum + row.count, 0);
    const checkedInTickets = ticketAgg.find((r) => r._id === TicketStatus.CHECKED_IN)?.count || 0;
    const cancelledTickets = ticketAgg.find((r) => r._id === TicketStatus.CANCELLED)?.count || 0;

    const ticketsByEvent = await Promise.all(
      (ticketByEvent as any[]).map(async (event) => {
        const sold = await this.ticketModel.countDocuments({
          eventId: event._id,
          status: { $ne: TicketStatus.CANCELLED },
        });
        return { eventId: event._id.toString(), eventName: event.title, ticketsSold: sold };
      }),
    );

    const tiers = await this.ticketTierModel
      .find({ eventId: { $in: (ticketByEvent as any[]).map((e) => e._id) } })
      .select('capacity soldCount reservedCount')
      .lean()
      .exec();
    const totalCapacity = tiers.reduce((sum, t: any) => sum + (t.capacity || 0), 0);
    const totalCommitted = tiers.reduce(
      (sum, t: any) => sum + (t.soldCount || 0) + (t.reservedCount || 0),
      0,
    );

    const upcoming = await this.eventModel
      .find({ tenantId: tid, status: EventStatus.PUBLISHED, endDate: { $gte: now } })
      .sort({ startDate: 1 })
      .limit(4)
      .select('title startDate location bannerUrl slug capacity')
      .lean()
      .exec();

    return {
      // Money
      totalRevenue: revenue.grossRevenue || 0,
      platformFees: revenue.fees || 0,
      netPayout: Math.max(0, (revenue.grossRevenue || 0) - (revenue.fees || 0)),
      totalPaidOrders: revenue.orders || 0,
      refundedAmount: refundAgg[0]?.amount || 0,
      refundedCount: refundAgg[0]?.count || 0,
      averageOrderValue:
        revenue.orders > 0 ? Math.round((revenue.grossRevenue / revenue.orders) * 100) / 100 : 0,
      pendingPayments: {
        count: pendingAgg[0]?.count || 0,
        amount: pendingAgg[0]?.amount || 0,
      },

      // Attendance
      totalTicketsSold,
      checkedInTickets,
      cancelledTickets,
      checkInRate: totalTicketsSold ? Math.round((checkedInTickets / totalTicketsSold) * 100) : 0,
      sellThrough: totalCapacity
        ? Math.round((totalCommitted / totalCapacity) * 100)
        : 0,
      capacity: totalCapacity,

      // Catalogue
      totalEvents: eventsAgg.reduce((sum, row) => sum + row.count, 0),
      activeEvents,
      upcomingEvents: upcoming,

      // Series
      salesOverTime: (salesOverTime as any[]).map((d) => ({
        date: d._id,
        revenue: d.revenue,
        orders: d.orders,
      })),
      ticketsByEvent,
      tierMix: (tierMix as any[]).map((t) => ({ name: t._id, count: t.count })),
      departments: (departments as any[]).map((d) => ({ name: d._id, count: d.count })),
      checkInVelocity: (checkInVelocity as any[]).map((v) => ({ hour: v._id, count: v.count })),
      recentOrders: recentOrders.map((order: any) => ({
        id: order._id.toString(),
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        totalAmount: order.totalAmount,
        status: order.status,
        createdAt: order.createdAt,
        event: order.eventId ? { title: order.eventId.title } : null,
      })),
    };
  }

  async getTenantAnalytics(tenantId: string) {
    return this.tenantScope(tenantId);
  }

  async getSuperAdminAnalytics() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [tenantCounts, eventCounts, ticketCounts, revenueAgg, tenants, topTenants, series] =
      await Promise.all([
        this.tenantModel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
        this.eventModel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
        this.ticketModel.aggregate([
          { $match: { status: { $ne: TicketStatus.CANCELLED } } },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        this.orderModel.aggregate([
          { $match: { status: OrderStatus.PAID } },
          {
            $group: {
              _id: null,
              gmv: { $sum: '$totalAmount' },
              fees: { $sum: { $ifNull: ['$platformFee', 0] } },
              orders: { $sum: 1 },
            },
          },
        ]),
        this.tenantModel.find().sort({ createdAt: -1 }).limit(8).lean().exec(),
        this.orderModel.aggregate([
          { $match: { status: OrderStatus.PAID } },
          { $group: { _id: '$tenantId', gmv: { $sum: '$totalAmount' }, orders: { $sum: 1 } } },
          { $sort: { gmv: -1 } },
          { $limit: 6 },
          {
            $lookup: {
              from: 'tenants',
              localField: '_id',
              foreignField: '_id',
              as: 'tenant',
            },
          },
          { $unwind: { path: '$tenant', preserveNullAndEmptyArrays: true } },
        ]),
        this.orderModel.aggregate([
          { $match: { status: OrderStatus.PAID, createdAt: { $gte: thirtyDaysAgo } } },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              revenue: { $sum: '$totalAmount' },
              orders: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ]),
      ]);

    const revenue = revenueAgg[0] || { gmv: 0, fees: 0, orders: 0 };
    const totalTicketsSold = ticketCounts.reduce((sum, row) => sum + row.count, 0);

    return {
      totalTenants: tenantCounts.reduce((sum, row) => sum + row.count, 0),
      activeTenants: tenantCounts.find((r) => r._id === TenantStatus.ACTIVE)?.count || 0,
      suspendedTenants: tenantCounts.find((r) => r._id === TenantStatus.SUSPENDED)?.count || 0,
      totalEvents: eventCounts.reduce((sum, row) => sum + row.count, 0),
      publishedEvents: eventCounts.find((r) => r._id === EventStatus.PUBLISHED)?.count || 0,
      totalTicketsSold,
      checkedInTickets: ticketCounts.find((r) => r._id === TicketStatus.CHECKED_IN)?.count || 0,
      globalGMV: revenue.gmv || 0,
      platformFees: revenue.fees || 0,
      paidOrders: revenue.orders || 0,
      tenants,
      topTenants: (topTenants as any[]).map((t) => ({
        tenantId: String(t._id),
        name: t.tenant?.name || 'Unknown',
        slug: t.tenant?.slug || null,
        gmv: t.gmv,
        orders: t.orders,
      })),
      salesOverTime: (series as any[]).map((s) => ({
        date: s._id,
        revenue: s.revenue,
        orders: s.orders,
      })),
    };
  }
}
