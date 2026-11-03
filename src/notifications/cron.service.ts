import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument, OrderStatus } from '../schemas/order.schema';
import { Event, EventDocument } from '../schemas/event.schema';
import { Tenant, TenantDocument } from '../schemas/tenant.schema';
import { ResendService } from '../resend/resend.service';
import { RedisService } from '../redis/redis.service';

/**
 * Scheduled attendee emails are claimed on the order before they are sent, and
 * guarded by a Redis lock. That makes them idempotent per order — a restart,
 * retry or second replica can never mail the same attendee twice.
 */
@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    @InjectModel(Tenant.name) private tenantModel: Model<TenantDocument>,
    private resendService: ResendService,
    private redisService: RedisService,
  ) {}

  private checkoutUrl(tenant: TenantDocument | null, event: EventDocument | null) {
    const frontend = (process.env.FRONTEND_URL || 'https://www.ticketr.org').replace(/\/+$/, '');
    if (!tenant || !event) return frontend;
    return `${frontend}/event/${event.slug}?tenant=${tenant.slug}`;
  }

  @Cron('*/15 * * * *')
  async handleAbandonedCarts() {
    const lock = await this.redisService.acquireLock('cron:abandoned-carts', 14 * 60);
    if (!lock) return;

    try {
      const now = Date.now();
      const abandonedOrders = await this.orderModel
        .find({
          status: OrderStatus.PENDING,
          'reminders.abandonedAt': { $exists: false },
          createdAt: {
            $lte: new Date(now - 30 * 60 * 1000),
            $gte: new Date(now - 24 * 60 * 60 * 1000),
          },
        })
        .populate('eventId')
        .limit(200);

      for (const order of abandonedOrders) {
        // Claim first: atomic so concurrent replicas cannot both send.
        const claimed = await this.orderModel.findOneAndUpdate(
          { _id: order._id, 'reminders.abandonedAt': { $exists: false } },
          { $set: { 'reminders.abandonedAt': new Date() } },
          { new: true },
        );
        if (!claimed) continue;

        const event = order.eventId as any as EventDocument;
        const tenant = event ? await this.tenantModel.findById(event.tenantId) : null;

        try {
          await this.resendService.sendPaymentReminder({
            toEmail: order.customerEmail,
            customerName: order.customerName,
            eventName: event ? event.title : 'Your event',
            orderNumber: order.orderNumber,
            checkoutUrl: this.checkoutUrl(tenant, event),
            customSubject: 'Your tickets are still reserved',
            customMessage:
              'We are holding your seats for a little longer. Complete checkout before the reservation expires and your tickets are released.',
          });
        } catch (err) {
          this.logger.error(`Abandoned cart email failed for ${order.orderNumber}`, err as any);
          // Release the claim so the next run can retry.
          await this.orderModel.updateOne(
            { _id: order._id },
            { $unset: { 'reminders.abandonedAt': '' } },
          );
        }
      }
    } finally {
      await this.redisService.releaseLock('cron:abandoned-carts');
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleEventReminders() {
    const lock = await this.redisService.acquireLock('cron:event-reminders', 55 * 60);
    if (!lock) return;

    try {
      const now = new Date();

      await this.remindWindow({
        from: new Date(now.getTime() + 23 * 60 * 60 * 1000),
        to: new Date(now.getTime() + 25 * 60 * 60 * 1000),
        field: 'dayBeforeAt',
        subject: (title) => `Tomorrow: ${title}`,
        message: (order, event) =>
          `Hi ${order.customerName}, ${event.title} is tomorrow at ${event.location}. Your QR ticket is in your Ticketr wallet — have it ready for a faster check-in.`,
      });

      await this.remindWindow({
        from: new Date(now.getTime() + 90 * 60 * 1000),
        to: new Date(now.getTime() + 150 * 60 * 1000),
        field: 'hoursBeforeAt',
        subject: (title) => `${title} starts in 2 hours`,
        message: (order, event) =>
          `It's almost time! ${event.title} starts soon at ${event.location}. Open your wallet now so your QR code is ready at the gate.`,
      });
    } finally {
      await this.redisService.releaseLock('cron:event-reminders');
    }
  }

  private async remindWindow(opts: {
    from: Date;
    to: Date;
    field: 'dayBeforeAt' | 'hoursBeforeAt';
    subject: (title: string) => string;
    message: (order: OrderDocument, event: EventDocument) => string;
  }) {
    const events = await this.eventModel
      .find({
        startDate: { $gte: opts.from, $lte: opts.to },
        status: 'PUBLISHED',
      })
      .limit(200);

    for (const event of events) {
      const orders = await this.orderModel
        .find({
          eventId: event._id,
          status: OrderStatus.PAID,
          [`reminders.${opts.field}`]: { $exists: false },
        })
        .limit(500);

      const tenant = await this.tenantModel.findById(event.tenantId);

      for (const order of orders) {
        const claimed = await this.orderModel.findOneAndUpdate(
          { _id: order._id, [`reminders.${opts.field}`]: { $exists: false } },
          { $set: { [`reminders.${opts.field}`]: new Date() } },
          { new: true },
        );
        if (!claimed) continue;

        try {
          await this.resendService.sendAttendeeReminder({
            toEmail: order.customerEmail,
            customerName: order.customerName,
            eventName: event.title,
            eventDate: new Date(event.startDate).toLocaleString(),
            eventLocation: event.location,
            subject: opts.subject(event.title),
            message: opts.message(order, event),
          });
        } catch (err) {
          this.logger.error(`Reminder failed for ${order.orderNumber}`, err as any);
          await this.orderModel.updateOne(
            { _id: order._id },
            { $unset: { [`reminders.${opts.field}`]: '' } },
          );
        }
      }
    }
  }
}
