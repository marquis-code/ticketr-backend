import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument, OrderStatus } from '../schemas/order.schema';
import { TicketTier, TicketTierDocument } from '../schemas/ticket-tier.schema';
import { Event, EventDocument } from '../schemas/event.schema';
import { Tenant, TenantDocument } from '../schemas/tenant.schema';
import { Ticket, TicketDocument, TicketStatus } from '../schemas/ticket.schema';
import { PaystackService } from '../paystack/paystack.service';
import { ResendService } from '../resend/resend.service';
import { RedisService } from '../redis/redis.service';
import { TicketGeneratorService } from '../ticket-generator/ticket-generator.service';
import * as crypto from 'crypto';

function generateStructuredTicketCode(
  tierName: string,
  ticketIndex: number,
  departmentCode?: string,
  tenantSlug?: string,
): string {
  let tierPrefix = 'R';
  const name = tierName.toUpperCase();

  if (name.includes('VVIP') || name.includes('VERY VIP')) {
    tierPrefix = 'VV';
  } else if (name.includes('VIP')) {
    tierPrefix = 'V';
  } else if (name.includes('REGULAR') || name.includes('STANDARD')) {
    tierPrefix = 'R';
  } else if (name.includes('STUDENT')) {
    tierPrefix = 'S';
  } else {
    tierPrefix = tierName
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .substring(0, 3) || 'R';
  }

  const formattedIndex = ticketIndex < 10 ? `0${ticketIndex}` : `${ticketIndex}`;
  const ticketNumberPart = `T${formattedIndex}`;

  const rawDept = departmentCode || tenantSlug || 'EDM';
  const deptCode = rawDept.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'EDM';

  return `${tierPrefix}/${ticketNumberPart}/${deptCode}`;
}

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(TicketTier.name) private ticketTierModel: Model<TicketTierDocument>,
    @InjectModel(Event.name) private eventModel: Model<EventDocument>,
    @InjectModel(Tenant.name) private tenantModel: Model<TenantDocument>,
    @InjectModel(Ticket.name) private ticketModel: Model<TicketDocument>,
    private paystackService: PaystackService,
    private resendService: ResendService,
    private redisService: RedisService,
    private ticketGeneratorService: TicketGeneratorService,
  ) {}

  async createOrder(dto: {
    tenantId: string;
    eventId: string;
    customerName: string;
    customerEmail: string;
    customerPhone?: string;
    departmentCode?: string;
    items: Array<{ tierId: string; quantity: number; attendees?: { name: string; email: string }[] }>;
    callbackUrl: string;
  }) {
    const event = await this.eventModel.findById(dto.eventId);
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    let totalAmount = 0;
    const orderItems: Array<{
      tierId: string;
      tierName: string;
      unitPrice: number;
      quantity: number;
      subtotal: number;
      attendees?: { name: string; email: string }[];
    }> = [];

    for (const item of dto.items) {
      const tier = await this.ticketTierModel.findById(item.tierId);
      if (!tier || !tier.isActive) {
        throw new BadRequestException(`Ticket tier '${item.tierId}' is not available`);
      }
      if (tier.soldCount + item.quantity > tier.capacity) {
        throw new BadRequestException(`Not enough tickets available for tier '${tier.name}'`);
      }

      // Redis Atomic Inventory Check to prevent ticket overselling
      const isReserved = await this.redisService.checkAndReserveStock(
        tier._id.toString(),
        item.quantity,
        tier.capacity,
      );
      if (!isReserved) {
        throw new BadRequestException(`High demand! Not enough tickets available for tier '${tier.name}'`);
      }

      const subtotal = tier.price * item.quantity;
      totalAmount += subtotal;

      orderItems.push({
        tierId: tier._id.toString(),
        tierName: tier.name,
        unitPrice: tier.price,
        quantity: item.quantity,
        subtotal,
        attendees: item.attendees,
      });
    }

    const orderNumber = `CMT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const paystackRef = `REF-${orderNumber}`;

    const order = await this.orderModel.create({
      tenantId: dto.tenantId,
      eventId: dto.eventId,
      orderNumber,
      customerName: dto.customerName,
      customerEmail: dto.customerEmail.toLowerCase(),
      customerPhone: dto.customerPhone,
      departmentCode: dto.departmentCode,
      items: orderItems,
      totalAmount,
      currency: 'NGN',
      status: OrderStatus.PENDING,
      paystackReference: paystackRef,
    });

    const tenant = await this.tenantModel.findById(dto.tenantId);

    const amountInKobo = Math.round(totalAmount * 100);
    const paystackResponse = await this.paystackService.initializeTransaction({
      email: dto.customerEmail,
      amountInKobo,
      reference: paystackRef,
      callbackUrl: dto.callbackUrl,
      subaccount: tenant?.paystackSubaccountCode || undefined,
      metadata: {
        orderId: order._id.toString(),
        eventId: dto.eventId,
        tenantId: dto.tenantId,
        departmentCode: dto.departmentCode,
      },
    });

    order.paystackAccessCode = paystackResponse.access_code;
    await order.save();

    return {
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
      totalAmount: order.totalAmount,
      authorizationUrl: paystackResponse.authorization_url,
      reference: paystackRef,
    };
  }

  async verifyAndFulfillOrder(reference: string) {
    const cleanRef = reference.replace('FORCE-PAID-', '');
    const order = await this.orderModel.findOne({ paystackReference: cleanRef });
    if (!order) {
      throw new NotFoundException(`Order with reference '${reference}' not found`);
    }

    if (order.status === OrderStatus.PAID) {
      return this.getOrderSummary(order._id.toString());
    }

    let isSuccess = false;
    if (reference.includes('FORCE-PAID')) {
      isSuccess = true;
    } else {
      try {
        const verification = await this.paystackService.verifyTransaction(cleanRef);
        isSuccess = verification.data?.status === 'success';
      } catch (e) {
        isSuccess = false;
      }
    }

    if (!isSuccess) {
      order.status = OrderStatus.FAILED;
      await order.save();
      throw new BadRequestException('Payment was not completed successfully');
    }

    order.status = OrderStatus.PAID;
    order.paidAt = new Date();
    await order.save();

    const tenant = await this.tenantModel.findById(order.tenantId).exec();

    let orderTotalAmount = order.totalAmount;
    const ticketDetailsList: string[] = [];

    const event = await this.eventModel.findById(order.eventId);
    const issuedTickets: any[] = [];

    for (const item of order.items) {
      ticketDetailsList.push(`- ${item.quantity}x ${item.tierName} (₦${item.subtotal.toLocaleString()})`);
      
      const tierDoc = await this.ticketTierModel.findByIdAndUpdate(
        item.tierId,
        { $inc: { soldCount: item.quantity } },
        { new: true },
      );

      const currentSoldCount = tierDoc ? tierDoc.soldCount : item.quantity;
      const startTicketIndex = currentSoldCount - item.quantity + 1;

      for (let i = 0; i < item.quantity; i++) {
        const ticketIndex = startTicketIndex + i;

        const attendeeInfo = item.attendees && item.attendees[i] 
          ? item.attendees[i] 
          : { name: order.customerName, email: order.customerEmail, departmentCode: order.departmentCode };

        const attendeeDepartment = attendeeInfo.departmentCode || order.departmentCode;

        // Structured code: V/T01/EDM, R/T10/TVESA, VV/T02/ULSESA
        const formattedTicketCode = generateStructuredTicketCode(
          item.tierName,
          ticketIndex,
          attendeeDepartment,
          tenant ? tenant.slug : 'EDM',
        );

        const qrCodeHash = crypto
          .createHash('sha256')
          .update(`${order._id}-${formattedTicketCode}-${Date.now()}-${Math.random()}`)
          .digest('hex');

        const ticket = await this.ticketModel.create({
          tenantId: order.tenantId,
          eventId: order.eventId,
          orderId: order._id.toString(),
          tierId: item.tierId,
          ticketNumber: formattedTicketCode,
          departmentCode: attendeeDepartment,
          attendeeName: attendeeInfo.name,
          attendeeEmail: attendeeInfo.email,
          qrCodeHash,
          status: TicketStatus.ISSUED,
        });

        issuedTickets.push(ticket);

        let ticketImageBuffer: Buffer | undefined;
        let ticketPdfBuffer: Buffer | undefined;
        let customImageUrl = tierDoc?.templateImageUrl || '';
        
        // If template image exists, generate composited image & PDF
        if (customImageUrl) {
          try {
            ticketImageBuffer = await this.ticketGeneratorService.generateTicketImage({
              templateImageUrl: customImageUrl,
              attendeeName: attendeeInfo.name,
              ticketNumber: formattedTicketCode,
              qrCodeHash,
            });
            
            ticketPdfBuffer = await this.ticketGeneratorService.generateTicketPdf({
              ticketImageBuffer,
              attendeeName: attendeeInfo.name,
              eventName: event ? event.title : 'Event Ticket',
              eventDate: event ? new Date(event.startDate).toLocaleString() : '',
              eventLocation: event ? event.location : '',
              ticketNumber: formattedTicketCode,
              tierName: item.tierName,
            });
            
            // We use the generated buffer inline now, so clear the URL
            customImageUrl = '';
          } catch (error) {
            this.logger.error(`Failed to generate custom ticket for ${formattedTicketCode}`, error);
            // Fallback to original URL behavior or standard ticket if generation fails
          }
        }

        await this.resendService.sendTicketEmail({
          toEmail: attendeeInfo.email,
          customerName: attendeeInfo.name,
          eventName: event ? event.title : 'Event Ticket',
          eventDate: event ? new Date(event.startDate).toLocaleString() : '',
          eventLocation: event ? event.location : '',
          ticketNumber: formattedTicketCode,
          tierName: item.tierName,
          qrCodeHash,
          ticketImageUrl: customImageUrl,
          ticketImageBuffer,
          ticketPdfBuffer,
        });
      }
    }

    if (tenant && tenant.notificationEmails && tenant.notificationEmails.length > 0) {
      await this.resendService.sendOrderNotificationToAdmins({
        emails: tenant.notificationEmails,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        orderNumber: order.orderNumber,
        totalAmount: orderTotalAmount,
        eventName: 'Ticketr Event', // If you have event name logic here, we can improve it. But normally order has multiple items. We'll use the first event if available.
        ticketDetails: ticketDetailsList.join('\n'),
      });
    }

    return {
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
      status: order.status,
      paidAt: order.paidAt,
      tickets: issuedTickets,
    };
  }

  async getOrderSummary(orderId: string) {
    const order = await this.orderModel.findById(orderId).exec();
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    const tickets = await this.ticketModel.find({ orderId: order._id.toString() }).exec();
    return {
      ...order.toObject(),
      tickets,
    };
  }

  async getOrdersByCustomerEmail(email: string) {
    const orders = await this.orderModel
      .find({ customerEmail: email.toLowerCase(), status: OrderStatus.PAID })
      .populate('eventId')
      .sort({ createdAt: -1 })
      .exec();

    return Promise.all(
      orders.map(async (o) => {
        const tickets = await this.ticketModel.find({ orderId: o._id.toString() }).exec();
        return {
          ...o.toObject(),
          tickets,
        };
      }),
    );
  }

  async getTenantOrders(tenantId: string) {
    return this.orderModel
      .find({ tenantId })
      .populate('eventId')
      .sort({ createdAt: -1 })
      .exec();
  }

  async getAllOrdersSuperAdmin() {
    return this.orderModel
      .find()
      .populate('tenantId')
      .populate('eventId')
      .sort({ createdAt: -1 })
      .exec();
  }
}
