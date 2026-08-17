import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument, OrderStatus } from '../schemas/order.schema';
import { Event, EventDocument } from '../schemas/event.schema';
import { ResendService } from '../resend/resend.service';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    private resendService: ResendService,
  ) {}

  // Run every 15 minutes to find abandoned carts
  @Cron('*/15 * * * *')
  async handleAbandonedCarts() {
    this.logger.log('Checking for abandoned carts...');
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // Find orders that are pending and were created between 30 mins and 1 hour ago
    const abandonedOrders = await this.orderModel.find({
      status: OrderStatus.PENDING,
      createdAt: { $lte: thirtyMinutesAgo, $gte: oneHourAgo },
    }).populate('eventId');

    for (const order of abandonedOrders) {
      const event = order.eventId as any as EventDocument;
      this.logger.log(`Sending abandoned cart email for order ${order.orderNumber}`);
      
      try {
        await this.resendService.sendPaymentReminder({
          toEmail: order.customerEmail,
          customerName: order.customerName,
          eventName: event ? event.title : 'Ticketr Event',
          orderNumber: order.orderNumber,
          checkoutUrl: `https://ticketr.org/${event?.slug || ''}`, // Replace with actual domain logic
          customSubject: 'You left something behind! Complete your ticket purchase',
          customMessage: 'Your tickets are still reserved. Complete your checkout before they are released!',
        });
        
        // Optionally mark order as reminded in a real app to avoid duplicates
      } catch (e) {
        this.logger.error(`Failed to send abandoned cart email for ${order.orderNumber}`, e);
      }
    }
  }

  // Run every hour to check for upcoming events (24h reminder)
  @Cron(CronExpression.EVERY_HOUR)
  async handleEventReminders() {
    this.logger.log('Checking for upcoming events to send reminders...');
    const now = new Date();

    // 24-hour window: events starting between 23h and 25h from now
    const twentyThreeHoursFromNow = new Date(now.getTime() + 23 * 60 * 60 * 1000);
    const twentyFiveHoursFromNow = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    const upcomingEvents24h = await this.eventModel.find({
      startDate: { $gte: twentyThreeHoursFromNow, $lte: twentyFiveHoursFromNow },
      status: 'PUBLISHED',
    });

    for (const event of upcomingEvents24h) {
      const paidOrders = await this.orderModel.find({
        eventId: event._id,
        status: OrderStatus.PAID,
      });

      for (const order of paidOrders) {
        try {
          await this.resendService.sendPaymentReminder({
            toEmail: order.customerEmail,
            customerName: order.customerName,
            eventName: event.title,
            orderNumber: order.orderNumber,
            checkoutUrl: `https://ticketr.org/event/${event.slug}`,
            customSubject: `⏰ Reminder: ${event.title} is tomorrow!`,
            customMessage: `Hey ${order.customerName}! Just a heads-up that ${event.title} is happening tomorrow at ${event.location}. Don't forget to bring your QR code ticket!`,
          });
        } catch (e) {
          this.logger.error(`Failed to send 24h reminder for order ${order.orderNumber}`, e);
        }
      }
    }

    // 2-hour window: events starting between 1.5h and 2.5h from now
    const ninetyMinutesFromNow = new Date(now.getTime() + 90 * 60 * 1000);
    const twoAndHalfHoursFromNow = new Date(now.getTime() + 150 * 60 * 1000);

    const upcomingEvents2h = await this.eventModel.find({
      startDate: { $gte: ninetyMinutesFromNow, $lte: twoAndHalfHoursFromNow },
      status: 'PUBLISHED',
    });

    for (const event of upcomingEvents2h) {
      const paidOrders = await this.orderModel.find({
        eventId: event._id,
        status: OrderStatus.PAID,
      });

      for (const order of paidOrders) {
        try {
          await this.resendService.sendPaymentReminder({
            toEmail: order.customerEmail,
            customerName: order.customerName,
            eventName: event.title,
            orderNumber: order.orderNumber,
            checkoutUrl: `https://ticketr.org/event/${event.slug}`,
            customSubject: `🎉 ${event.title} starts in 2 hours!`,
            customMessage: `It's almost time! ${event.title} is starting very soon at ${event.location}. Make sure you have your QR code ready for check-in.`,
          });
        } catch (e) {
          this.logger.error(`Failed to send 2h reminder for order ${order.orderNumber}`, e);
        }
      }
    }
  }
}
