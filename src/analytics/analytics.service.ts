import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument, OrderStatus } from '../schemas/order.schema';
import { Ticket, TicketDocument, TicketStatus } from '../schemas/ticket.schema';
import { Event, EventDocument } from '../schemas/event.schema';
import { Tenant, TenantDocument } from '../schemas/tenant.schema';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(Ticket.name) private ticketModel: Model<TicketDocument>,
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    @InjectModel(Tenant.name) private tenantModel: Model<TenantDocument>,
  ) {}

  async getTenantAnalytics(tenantId: string) {
    const paidOrders = await this.orderModel.find({ tenantId, status: OrderStatus.PAID }).exec();
    const totalRevenue = paidOrders.reduce((sum, o) => sum + o.totalAmount, 0);

    const totalTicketsSold = await this.ticketModel.countDocuments({ tenantId });
    const checkedInTickets = await this.ticketModel.countDocuments({ tenantId, status: TicketStatus.CHECKED_IN });
    const totalEvents = await this.eventModel.countDocuments({ tenantId });

    const recentOrders = await this.orderModel
      .find({ tenantId })
      .sort({ createdAt: -1 })
      .limit(5)
      .exec();

    return {
      totalRevenue,
      totalTicketsSold,
      checkedInTickets,
      totalEvents,
      checkInRate: totalTicketsSold > 0 ? Math.round((checkedInTickets / totalTicketsSold) * 100) : 0,
      recentOrders,
    };
  }

  async getSuperAdminAnalytics() {
    const totalTenants = await this.tenantModel.countDocuments();
    const totalEvents = await this.eventModel.countDocuments();
    const totalTicketsSold = await this.ticketModel.countDocuments();

    const paidOrders = await this.orderModel.find({ status: OrderStatus.PAID }).exec();
    const globalGMV = paidOrders.reduce((sum, o) => sum + o.totalAmount, 0);

    const tenants = await this.tenantModel.find().sort({ createdAt: -1 }).limit(10).exec();

    return {
      totalTenants,
      totalEvents,
      totalTicketsSold,
      globalGMV,
      tenants,
    };
  }
}
