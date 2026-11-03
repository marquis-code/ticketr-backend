import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument, OrderStatus } from '../schemas/order.schema';
import { TicketTier, TicketTierDocument } from '../schemas/ticket-tier.schema';
import {
  Event,
  EventDocument,
  EventStatus,
  MarkupFeeType,
  MarkupStrategy,
} from '../schemas/event.schema';
import { Tenant, TenantDocument, TenantStatus } from '../schemas/tenant.schema';
import { Ticket, TicketDocument, TicketStatus } from '../schemas/ticket.schema';
import { Payout, PayoutDocument, PayoutStatus } from '../schemas/payout.schema';
import { PaystackService } from '../paystack/paystack.service';
import { ResendService } from '../resend/resend.service';
import { RedisService } from '../redis/redis.service';
import { TicketGeneratorService } from '../ticket-generator/ticket-generator.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import * as crypto from 'crypto';

const RESERVATION_TTL_MINUTES = 30;
const FULFILLMENT_STALE_MINUTES = 10;

type MarkupSettings = {
  markupFee?: number;
  markupFeeType?: MarkupFeeType;
  markupStrategy?: MarkupStrategy;
};

export interface CreateOrderDto {
  tenantId: string;
  eventId: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  departmentCode?: string;
  isInstallmentPlan?: boolean;
  promoCode?: string;
  items: Array<{
    tierId: string;
    quantity: number;
    attendees?: Array<{
      name: string;
      email: string;
      departmentCode?: string;
      customData?: Record<string, string>;
    }>;
  }>;
  callbackUrl: string;
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
    @InjectModel(Payout.name) private payoutModel: Model<PayoutDocument>,
    private paystackService: PaystackService,
    private resendService: ResendService,
    private redisService: RedisService,
    private ticketGeneratorService: TicketGeneratorService,
    private cloudinaryService: CloudinaryService,
  ) {}

  // ---------------------------------------------------------------------------
  // Pricing helpers (one source of truth for checkout and fulfillment)
  // ---------------------------------------------------------------------------

  /** How many physical tickets one purchased unit produces (couples, tables...). */
  ticketUnitsPerQuantity(tier: { name?: string; isCoupleTicket?: boolean } | null): number {
    if (!tier) return 1;
    if (tier.isCoupleTicket) return 2;
    const match = (tier.name || '').match(/table\s+(?:of|for)?\s*(\d+)/i);
    if (match) return Math.max(1, parseInt(match[1], 10));
    return 1;
  }

  calculateItemMarkup(subtotal: number, quantity: number, tier: MarkupSettings): number {
    const fee = Number(tier.markupFee || 0);
    if (fee <= 0) return 0;
    if (tier.markupFeeType === MarkupFeeType.PERCENTAGE) {
      return Math.round((fee / 100) * subtotal * 100) / 100;
    }
    return Math.round(fee * quantity * 100) / 100;
  }

  private eventTicketCode(event: EventDocument): string {
    const slug = (event.slug || 'TIX').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const fromSlug = (slug + 'XXX').slice(0, 4);
    const fromId = event._id.toString().slice(-3).toUpperCase();
    return `${fromSlug}${fromId}`;
  }

  private generateTicketNumber(
    tierName: string,
    ticketIndex: number,
    departmentCode: string | undefined,
    eventCode: string,
  ): string {
    let tierPrefix = 'R';
    const name = (tierName || '').toUpperCase();

    if (name.includes('VVIP') || name.includes('VERY VIP')) tierPrefix = 'VV';
    else if (name.includes('VIP')) tierPrefix = 'V';
    else if (name.includes('REGULAR') || name.includes('STANDARD')) tierPrefix = 'R';
    else if (name.includes('STUDENT')) tierPrefix = 'S';
    else if (name.includes('GUYS') || name.includes('GUY')) tierPrefix = 'GT';
    else if (name.includes('GIRLS') || name.includes('GIRL')) tierPrefix = 'GRL';
    else if (name.includes('TABLE')) tierPrefix = 'TBL';
    else if (name.includes('FREE')) tierPrefix = 'F';
    else if (name.includes('EARLY')) tierPrefix = 'EB';
    else {
      tierPrefix =
        tierName
          .split(' ')
          .filter(Boolean)
          .map((w) => w[0])
          .join('')
          .toUpperCase()
          .substring(0, 3) || 'R';
    }

    const index = ticketIndex < 10 ? `0${ticketIndex}` : `${ticketIndex}`;
    const dept = (departmentCode || 'GEN').replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'GEN';
    return `${tierPrefix}/${eventCode}/T${index}/${dept}`;
  }

  private generateWalletToken(): string {
    return crypto.randomBytes(24).toString('hex');
  }

  // ---------------------------------------------------------------------------
  // Inventory: atomic reservation on the tier document.
  // Mongo is the source of truth, so a cold Redis cache can never oversell.
  // ---------------------------------------------------------------------------

  private async reserveUnits(tierId: string, units: number): Promise<TicketTierDocument> {
    const tier = await this.ticketTierModel
      .findOneAndUpdate(
        {
          _id: tierId,
          isActive: true,
          $expr: {
            $lte: [
              { $add: ['$soldCount', { $ifNull: ['$reservedCount', 0] }, units] },
              '$capacity',
            ],
          },
        },
        { $inc: { reservedCount: units } },
        { new: true },
      )
      .exec();

    if (!tier) {
      const exists = await this.ticketTierModel.findById(tierId);
      if (!exists) throw new BadRequestException('One of the selected ticket tiers no longer exists');
      if (!exists.isActive) throw new BadRequestException(`'${exists.name}' is not on sale`);
      throw new BadRequestException(
        `Only a few '${exists.name}' tickets remain. Please reduce the quantity.`,
      );
    }
    return tier;
  }

  private async findOrderForTenant(orderId: string, tenantId?: string) {
    const filter: any = { _id: orderId };
    if (tenantId) filter.tenantId = tenantId;
    const order = await this.orderModel.findOne(filter);
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  private async releaseUnits(tierId: string, units: number): Promise<void> {
    if (!units || units <= 0) return;
    await this.ticketTierModel.updateOne(
      { _id: tierId, reservedCount: { $gt: 0 } },
      [
        {
          $set: {
            reservedCount: {
              $max: [0, { $subtract: [{ $ifNull: ['$reservedCount', 0] }, units] }],
            },
          },
        },
      ] as any,
    );
  }

  private async releaseOrderReservation(order: OrderDocument, reason: string): Promise<void> {
    if (order.reservationState !== 'HELD') return;
    for (const item of order.items) {
      const units = item.reservedUnits || item.quantity;
      await this.releaseUnits(item.tierId.toString(), units);
    }
    order.reservationState = 'RELEASED';
    order.reservationExpiresAt = undefined;
    order.cancelledAt = new Date();
    order.cancellationReason = reason;
    await order.save();
  }

  /**
   * Abandoned checkouts must never lock inventory forever.
   * Called by the maintenance cron and opportunistically on each checkout.
   */
  async releaseExpiredReservations(): Promise<number> {
    const expired = await this.orderModel.find({
      status: OrderStatus.PENDING,
      reservationState: 'HELD',
      reservationExpiresAt: { $lt: new Date() },
    });

    let released = 0;
    for (const order of expired) {
      try {
        await this.releaseOrderReservation(order, 'Checkout session expired');
        order.status = OrderStatus.CANCELLED;
        await order.save();
        await this.restorePromoUsage(order);
        released++;
      } catch (err) {
        this.logger.error(`Failed to release reservation for ${order.orderNumber}`, err as any);
      }
    }
    return released;
  }

  // ---------------------------------------------------------------------------
  // Promo codes: validated and consumed server-side. Never trust a client price.
  // ---------------------------------------------------------------------------

  async validatePromoCode(code: string, eventId: string) {
    const event = await this.eventModel.findById(eventId);
    if (!event) throw new NotFoundException('Event not found');
    const { promo } = await this.resolvePromo(event, code, 0, false);
    return {
      valid: true,
      code: promo.code,
      type: promo.type || 'PERCENTAGE',
      value: promo.value || 0,
      remainingUses: promo.maxUses
        ? Math.max(0, promo.maxUses - (promo.usedCount || 0))
        : null,
    };
  }

  private async resolvePromo(
    event: EventDocument,
    code: string | undefined,
    subtotal: number,
    consume: boolean,
  ) {
    if (!code || !code.trim()) {
      return { promo: null as any, discount: 0 };
    }

    const normalized = code.trim().toUpperCase();
    const promoCodes = ((event as any).promoCodes || []) as any[];
    const promo = promoCodes.find(
      (p) => (p.code || '').toUpperCase() === normalized && p.isActive !== false,
    );

    if (!promo) throw new BadRequestException('That promo code is not valid for this event');
    if (promo.expiresAt && new Date(promo.expiresAt) < new Date()) {
      throw new BadRequestException('That promo code has expired');
    }
    if (promo.startsAt && new Date(promo.startsAt) > new Date()) {
      throw new BadRequestException('That promo code is not active yet');
    }
    if (promo.maxUses && (promo.usedCount || 0) >= promo.maxUses) {
      throw new BadRequestException('That promo code has reached its usage limit');
    }

    let discount = 0;
    if (subtotal > 0) {
      discount =
        promo.type === 'FLAT'
          ? Math.min(subtotal, Number(promo.value) || 0)
          : Math.min(subtotal, ((Number(promo.value) || 0) / 100) * subtotal);
      discount = Math.round(discount * 100) / 100;
    }

    if (consume) {
      const updated = await this.eventModel.findOneAndUpdate(
        { _id: event._id, 'promoCodes.code': promo.code, 'promoCodes.isActive': { $ne: false } },
        { $inc: { 'promoCodes.$.usedCount': 1 } },
        { new: true },
      );
      if (!updated) throw new BadRequestException('That promo code is no longer available');

      const refreshed = ((updated as any).promoCodes || []).find(
        (p: any) => p.code === promo.code,
      );
      if (refreshed?.maxUses && (refreshed.usedCount || 0) > refreshed.maxUses) {
        await this.eventModel.updateOne(
          { _id: event._id, 'promoCodes.code': promo.code },
          { $inc: { 'promoCodes.$.usedCount': -1 } },
        );
        throw new BadRequestException('That promo code has reached its usage limit');
      }
    }

    return { promo, discount };
  }

  // ---------------------------------------------------------------------------
  // Create order
  // ---------------------------------------------------------------------------

  async createOrder(dto: CreateOrderDto) {
    if (!dto.items?.length) throw new BadRequestException('Select at least one ticket');
    if (!dto.customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(dto.customerEmail)) {
      throw new BadRequestException('Please provide a valid email address');
    }
    if (!dto.customerName || dto.customerName.trim().length < 2) {
      throw new BadRequestException('Please provide the buyer’s full name');
    }

    const event = await this.eventModel.findById(dto.eventId);
    if (!event) throw new NotFoundException('Event not found');
    if (event.status !== EventStatus.PUBLISHED) {
      throw new BadRequestException('Tickets for this event are not on sale');
    }
    if (new Date(event.endDate).getTime() < Date.now()) {
      throw new BadRequestException('This event has ended');
    }

    const tenant = await this.tenantModel.findById(dto.tenantId);
    if (!tenant) throw new NotFoundException('Organizer not found');
    if (tenant.status !== TenantStatus.ACTIVE) {
      throw new BadRequestException('This organizer is not currently accepting payments');
    }
    if (event.tenantId.toString() !== tenant._id.toString()) {
      throw new BadRequestException('This event does not belong to the selected organizer');
    }

    const normalizedEmail = dto.customerEmail.toLowerCase().trim();
    await this.releaseExpiredReservations();

    // A buyer who already owns a ticket must never be charged twice.
    const existingPaidOrder = await this.orderModel.findOne({
      eventId: dto.eventId,
      customerEmail: normalizedEmail,
      status: OrderStatus.PAID,
    });
    if (existingPaidOrder) {
      return {
        isAlreadyPaid: true,
        orderId: existingPaidOrder._id.toString(),
        orderNumber: existingPaidOrder.orderNumber,
        customerEmail: existingPaidOrder.customerEmail,
        customerName: existingPaidOrder.customerName,
        totalAmount: existingPaidOrder.totalAmount,
        message: `You already have a confirmed ticket (order #${existingPaidOrder.orderNumber}) for this event. Use “Find my tickets” to open your wallet.`,
      };
    }

    // Resume a live checkout session instead of creating duplicates.
    const existingPending = await this.orderModel.findOne({
      eventId: dto.eventId,
      customerEmail: normalizedEmail,
      $or: [
        { status: OrderStatus.AWAITING_APPROVAL },
        { status: OrderStatus.PENDING, reservationExpiresAt: { $gt: new Date() } },
      ],
    });

    if (existingPending) {
      if (existingPending.status === OrderStatus.AWAITING_APPROVAL) {
        return {
          resumedSession: true,
          isAwaitingApproval: true,
          orderId: existingPending._id.toString(),
          orderNumber: existingPending.orderNumber,
          totalAmount: existingPending.totalAmount,
          status: existingPending.status,
          checkoutStep: 'PROOF_UPLOADED',
          proofOfPaymentUrl: existingPending.proofOfPaymentUrl,
          paymentMethod: existingPending.paymentMethod,
          remittanceAccount: tenant.primaryRemittanceAccount || tenant.remittanceAccount,
          message: `Order #${existingPending.orderNumber} is already awaiting payment verification.`,
        };
      }

      const signature = (items: any[]) =>
        JSON.stringify([...items].map((i) => `${i.tierId}:${i.quantity}`).sort());
      const sameSelection = signature(existingPending.items) === signature(dto.items);

      if (!sameSelection) {
        await this.releaseOrderReservation(existingPending, 'Superseded by a new selection');
        existingPending.status = OrderStatus.CANCELLED;
        await existingPending.save();
      } else {
        try {
          return await this.resumePaystackCheckout(existingPending, tenant, dto);
        } catch (err) {
          await this.releaseOrderReservation(existingPending, 'Could not resume payment');
          throw err;
        }
      }
    }

    // Price everything server-side.
    let subtotal = 0;
    let markupTotal = 0;
    let addToFeeTotal = 0;
    const orderItems: any[] = [];
    const reservations: Array<{ tierId: string; units: number }> = [];

    for (const item of dto.items) {
      const quantity = Math.max(1, Math.floor(Number(item.quantity) || 0));
      const tier = await this.ticketTierModel.findById(item.tierId);
      if (!tier || tier.isActive !== true) {
        throw new BadRequestException('One of the selected ticket tiers is not available');
      }
      if (tier.eventId.toString() !== event._id.toString()) {
        throw new BadRequestException('Ticket tier does not belong to this event');
      }
      if (quantity > (tier.maxPerPurchase || 5)) {
        throw new BadRequestException(
          `You can buy up to ${tier.maxPerPurchase || 5} ${tier.name} ticket(s) per order`,
        );
      }
      if (tier.salesStartAt && new Date(tier.salesStartAt) > new Date()) {
        throw new BadRequestException(`${tier.name} sales have not started yet`);
      }
      if (tier.salesEndAt && new Date(tier.salesEndAt) < new Date()) {
        throw new BadRequestException(`${tier.name} sales have ended`);
      }

      const itemSubtotal = Number(tier.price) * quantity;
      const itemMarkup = this.calculateItemMarkup(itemSubtotal, quantity, tier);
      const units = quantity * this.ticketUnitsPerQuantity(tier);

      subtotal += itemSubtotal;
      markupTotal += itemMarkup;
      if (tier.markupStrategy === MarkupStrategy.ADD_TO_FEE) addToFeeTotal += itemMarkup;

      orderItems.push({
        tierId: tier._id.toString(),
        tierName: tier.name,
        tierDescription: tier.description,
        unitPrice: Number(tier.price),
        quantity,
        subtotal: itemSubtotal,
        markupAmount: itemMarkup,
        reservedUnits: units,
        attendees: item.attendees || [],
      });
      reservations.push({ tierId: tier._id.toString(), units });
    }

    const { promo, discount } = await this.resolvePromo(event, dto.promoCode, subtotal, false);
    const buyerTotal = subtotal + addToFeeTotal;
    const chargeableAmount = Math.max(0, Math.round((buyerTotal - discount) * 100) / 100);
    const platformFee = Math.round(markupTotal * 100) / 100;
    const netToOrganizer = Math.round((chargeableAmount - platformFee) * 100) / 100;

    // Reserve inventory atomically; release partial holds if any tier fails.
    for (const reservation of reservations) {
      try {
        await this.reserveUnits(reservation.tierId, reservation.units);
      } catch (err) {
        for (const held of reservations) {
          if (held === reservation) break;
          await this.releaseUnits(held.tierId, held.units);
        }
        throw err;
      }
    }

    const orderNumber = `TIX-${Date.now().toString(36).toUpperCase()}-${crypto
      .randomBytes(3)
      .toString('hex')
      .toUpperCase()}`;
    const paystackRef = `REF-${orderNumber}`;
    const walletToken = this.generateWalletToken();
    // Bank transfers legitimately take hours. Card checkouts hold stock for 30
    // minutes; manual-transfer orders get a full day before stock is released.
    const holdMinutes =
      tenant.paymentMethod === 'MANUAL_TRANSFER' ? 24 * 60 : RESERVATION_TTL_MINUTES;
    const reservationExpiresAt = new Date(Date.now() + holdMinutes * 60 * 1000);

    let order: OrderDocument;
    try {
      order = await this.orderModel.create({
        tenantId: dto.tenantId,
        eventId: dto.eventId,
        orderNumber,
        customerName: dto.customerName.trim(),
        customerEmail: normalizedEmail,
        customerPhone: dto.customerPhone,
        departmentCode: dto.departmentCode,
        items: orderItems,
        totalAmount: chargeableAmount,
        platformFee,
        netToOrganizer,
        currency: 'NGN',
        status: OrderStatus.PENDING,
        checkoutStep: 'PAYMENT_PENDING',
        isInstallmentPlan: !!dto.isInstallmentPlan,
        amountRemaining: chargeableAmount,
        promoCode: promo?.code,
        discountAmount: discount,
        paystackReference: tenant.paymentMethod === 'PAYSTACK' ? paystackRef : undefined,
        paymentMethod: tenant.paymentMethod || 'PAYSTACK',
        walletToken,
        fulfillmentStatus: 'PENDING',
        reservationState: 'HELD',
        reservationExpiresAt,
        ticketsIssued: 0,
      });
    } catch (err) {
      for (const held of reservations) await this.releaseUnits(held.tierId, held.units);
      throw err;
    }

    // Consume promo usage only once the order exists; roll back on failure.
    if (promo && discount > 0) {
      try {
        await this.resolvePromo(event, promo.code, subtotal, true);
      } catch (err) {
        await this.releaseOrderReservation(order, 'Promo code could not be applied');
        await this.orderModel.deleteOne({ _id: order._id });
        throw err;
      }
    }

    if (tenant.paymentMethod === 'MANUAL_TRANSFER') {
      return {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        totalAmount: order.totalAmount,
        paymentMethod: 'MANUAL_TRANSFER',
        checkoutStep: 'PAYMENT_PENDING',
        walletToken,
        remittanceAccount: tenant.primaryRemittanceAccount || tenant.remittanceAccount,
        message: 'Order reserved. Transfer the exact amount and upload your proof of payment.',
      };
    }

    try {
      return await this.initializePaystackCheckout(
        order,
        tenant,
        dto.callbackUrl,
        dto.isInstallmentPlan,
      );
    } catch (err) {
      await this.releaseOrderReservation(order, 'Payment could not be initialized');
      order.status = OrderStatus.FAILED;
      await order.save();
      throw err;
    }
  }

  private async initializePaystackCheckout(
    order: OrderDocument,
    tenant: TenantDocument,
    callbackUrl: string,
    isInstallmentPlan?: boolean,
  ) {
    const baseAmount = isInstallmentPlan ? order.totalAmount / 2 : order.totalAmount;
    const amountToCharge = Math.round(baseAmount * 100) / 100;

    if (amountToCharge <= 0) {
      // Free tickets: no gateway round-trip, fulfill immediately.
      order.status = OrderStatus.PAID;
      order.paidAt = new Date();
      order.paymentMethod = order.paymentMethod || 'FREE';
      await order.save();
      return this.verifyAndFulfillOrder(`FORCE-PAID-${order.orderNumber}`, { freeOrder: true });
    }

    const amountInKobo = Math.round(amountToCharge * 100);
    const reference = `${order.paystackReference || `REF-${order.orderNumber}`}-${Date.now().toString(36)}`;

    const payload: any = {
      email: order.customerEmail,
      amountInKobo,
      reference,
      callbackUrl,
      subaccount: tenant?.paystackSubaccountCode || undefined,
      metadata: {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        eventId: order.eventId.toString(),
        tenantId: order.tenantId.toString(),
        type: isInstallmentPlan ? 'INSTALLMENT' : 'ORDER',
      },
    };

    const paystackResponse = await this.paystackService.initializeTransaction(payload);

    order.paystackAccessCode = paystackResponse.access_code;
    order.paystackReference = reference;
    order.checkoutStep = 'PAYMENT_PENDING';
    await order.save();

    return {
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
      totalAmount: order.totalAmount,
      amountDueNow: amountToCharge,
      paymentMethod: 'PAYSTACK',
      authorizationUrl: paystackResponse.authorization_url,
      reference,
    };
  }

  private async resumePaystackCheckout(
    order: OrderDocument,
    tenant: TenantDocument,
    dto: CreateOrderDto,
  ) {
    order.customerName = dto.customerName.trim();
    order.customerPhone = dto.customerPhone;
    if (dto.departmentCode) order.departmentCode = dto.departmentCode;
    order.reservationExpiresAt = new Date(Date.now() + RESERVATION_TTL_MINUTES * 60 * 1000);
    await order.save();

    if (order.paymentMethod === 'MANUAL_TRANSFER') {
      return {
        resumedSession: true,
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        totalAmount: order.totalAmount,
        paymentMethod: 'MANUAL_TRANSFER',
        checkoutStep: 'PAYMENT_PENDING',
        walletToken: order.walletToken,
        remittanceAccount: tenant.primaryRemittanceAccount || tenant.remittanceAccount,
        message: `Resumed order #${order.orderNumber}.`,
      };
    }

    const result = await this.initializePaystackCheckout(
      order,
      tenant,
      dto.callbackUrl,
      order.isInstallmentPlan,
    );
    return { ...result, resumedSession: true, message: `Resumed order #${order.orderNumber}.` };
  }

  // ---------------------------------------------------------------------------
  // Fulfillment — idempotent, lock-protected, retry-safe.
  // ---------------------------------------------------------------------------

  async verifyAndFulfillOrder(
    reference: string,
    options: { freeOrder?: boolean; verifiedAmountKobo?: number } = {},
  ) {
    const cleanRef = (reference || '').replace('FORCE-PAID-', '');
    const order = await this.orderModel.findOne({
      $or: [
        { paystackReference: cleanRef },
        { balancePaymentReference: cleanRef },
        { orderNumber: cleanRef },
      ],
    });
    if (!order) throw new NotFoundException(`Order with reference '${reference}' not found`);

    const expectedTickets = order.items.reduce(
      (sum, item) => sum + (item.reservedUnits || item.quantity),
      0,
    );
    const existingCount = await this.ticketModel.countDocuments({
      orderId: order._id.toString(),
    });

    if (order.status === OrderStatus.PAID && existingCount >= expectedTickets) {
      return this.getOrderSummary(order._id.toString());
    }

    // Acquire the fulfillment lock. A second webhook/verify call waits for the
    // first and returns the completed summary instead of issuing duplicates.
    const staleBefore = new Date(Date.now() - FULFILLMENT_STALE_MINUTES * 60 * 1000);
    const lock = await this.orderModel.findOneAndUpdate(
      {
        _id: order._id,
        $or: [
          { fulfillmentStatus: { $in: ['PENDING', 'FAILED', null] } },
          { fulfillmentStatus: { $exists: false } },
          { fulfillmentStatus: 'IN_PROGRESS', fulfillmentStartedAt: { $lt: staleBefore } },
        ],
      },
      { $set: { fulfillmentStatus: 'IN_PROGRESS', fulfillmentStartedAt: new Date() } },
      { new: true },
    );

    if (!lock) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const refreshed = await this.orderModel.findById(order._id);
      const ticketsNow = await this.ticketModel.countDocuments({
        orderId: order._id.toString(),
      });
      if (refreshed?.status === OrderStatus.PAID && ticketsNow >= expectedTickets) {
        return this.getOrderSummary(order._id.toString());
      }
      throw new ConflictException(
        'Tickets for this order are being issued right now. Please refresh in a moment.',
      );
    }

    try {
      let isSuccess = !!options.freeOrder || reference.includes('FORCE-PAID');
      let verifiedAmountKobo = options.verifiedAmountKobo || 0;

      if (!isSuccess) {
        try {
          const verification = await this.paystackService.verifyTransaction(cleanRef);
          isSuccess = verification?.data?.status === 'success';
          verifiedAmountKobo = Number(verification?.data?.amount || 0);
        } catch {
          isSuccess = false;
        }
      }

      if (!isSuccess) {
        order.status = OrderStatus.FAILED;
        order.fulfillmentStatus = 'FAILED';
        await this.releaseOrderReservation(order, 'Payment failed');
        await order.save();
        throw new BadRequestException('Payment was not completed successfully');
      }

      const isMockGateway = String(process.env.PAYSTACK_SECRET_KEY || '').startsWith('sk_test_mock');
      let amountPaidNow = verifiedAmountKobo > 0 ? verifiedAmountKobo / 100 : undefined;

      // In mock mode the gateway always reports a placeholder amount; treat the
      // intended charge as paid so local/demo checkout completes end-to-end.
      if (isMockGateway && !reference.includes('FORCE-PAID')) {
        amountPaidNow = order.isInstallmentPlan
          ? order.amountPaid > 0 && order.amountRemaining > 0
            ? order.amountRemaining
            : Math.ceil(order.totalAmount / 2)
          : order.totalAmount - (order.amountPaid || 0);
      }

      if (!options.freeOrder && !reference.includes('FORCE-PAID')) {
        const expectedNow = order.isInstallmentPlan
          ? order.amountPaid > 0 && order.amountRemaining > 0
            ? order.amountRemaining
            : Math.ceil(order.totalAmount / 2)
          : order.totalAmount - (order.amountPaid || 0);

        if (!isMockGateway && verifiedAmountKobo > 0 && verifiedAmountKobo + 1 < Math.round(expectedNow * 100)) {
          this.logger.warn(
            `Underpayment for ${order.orderNumber}: got ${verifiedAmountKobo} kobo, expected ${Math.round(
              expectedNow * 100,
            )}`,
          );
          order.fulfillmentStatus = 'FAILED';
          await this.releaseOrderReservation(order, 'Underpayment received');
          await order.save();
          throw new BadRequestException(
            'The amount received does not match the order total. Please contact the organizer.',
          );
        }
      }

      const previousPaid = order.amountPaid || 0;
      order.amountPaid = Math.min(
        order.totalAmount,
        Math.round((previousPaid + (amountPaidNow ?? order.totalAmount)) * 100) / 100,
      );
      order.amountRemaining = Math.max(
        0,
        Math.round((order.totalAmount - order.amountPaid) * 100) / 100,
      );

      if (order.amountRemaining > 0.5) {
        order.status = OrderStatus.PARTIALLY_PAID;
        order.fulfillmentStatus = 'PENDING';
        order.nextPaymentDueDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        // The document was hydrated by the lock's findOneAndUpdate; force the
        // status change through so the next balance payment can acquire the lock.
        order.markModified('fulfillmentStatus');
        await order.save();
        return {
          orderId: order._id.toString(),
          orderNumber: order.orderNumber,
          status: order.status,
          amountPaid: order.amountPaid,
          amountRemaining: order.amountRemaining,
          walletToken: order.walletToken,
          message: 'Part payment received. Tickets are issued once the balance is settled.',
        };
      }

      order.status = OrderStatus.PAID;
      order.amountRemaining = 0;
      order.paidAt = order.paidAt || new Date();
      order.fulfillmentStatus = 'IN_PROGRESS';
      await order.save();

      await this.issueTicketsForOrder(order);

      order.fulfillmentStatus = 'DONE';
      order.fulfillmentCompletedAt = new Date();
      order.ticketsIssued = await this.ticketModel.countDocuments({
        orderId: order._id.toString(),
      });
      order.reservationExpiresAt = undefined;
      await order.save();

      return this.getOrderSummary(order._id.toString());
    } catch (err) {
      const current = await this.orderModel.findById(order._id);
      if (current) {
        current.fulfillmentStatus = 'FAILED';
        await current.save();
      }
      throw err;
    }
  }

  private async issueTicketsForOrder(order: OrderDocument): Promise<void> {
    const tenant = await this.tenantModel.findById(order.tenantId).exec();
    const event = await this.eventModel.findById(order.eventId);
    if (!event) throw new NotFoundException('Event for this order no longer exists');

    const frontend = (process.env.FRONTEND_URL || 'https://ticketr.org').replace(/\/+$/, '');
    const walletUrl = `${frontend}/my-tickets?token=${order.walletToken}`;

    const existingTickets = await this.ticketModel.find({ orderId: order._id.toString() }).exec();
    const existingByTier = new Map<string, number>();
    for (const ticket of existingTickets) {
      const key = ticket.tierId?.toString() || '';
      existingByTier.set(key, (existingByTier.get(key) || 0) + 1);
    }

    const eventCode = this.eventTicketCode(event);

    for (const item of order.items) {
      const tierDoc = await this.ticketTierModel.findById(item.tierId);
      const unitsPerQuantity = this.ticketUnitsPerQuantity(tierDoc);
      const ticketsToGenerate = item.quantity * unitsPerQuantity;

      const alreadyGenerated = existingByTier.get(item.tierId.toString()) || 0;
      const missing = Math.max(0, ticketsToGenerate - alreadyGenerated);
      if (missing === 0) continue;

      const updatedTier = await this.ticketTierModel.findByIdAndUpdate(
        item.tierId,
        { $inc: { soldCount: missing } },
        { new: true },
      );
      const newSoldCount = updatedTier?.soldCount ?? missing;
      let nextIndex = newSoldCount - missing + 1;

      const dept = (
        order.departmentCode ||
        item.attendees?.[0]?.departmentCode ||
        'GEN'
      )
        .toString()
        .toUpperCase();

      for (let i = alreadyGenerated; i < ticketsToGenerate; i++) {
        const attendee = item.attendees?.[i];
        let attendeeName = attendee?.name?.trim() || order.customerName;
        if (tierDoc?.isCoupleTicket) {
          attendeeName = `${attendeeName} (${i % 2 === 0 ? 'Male' : 'Female'})`;
        } else if (unitsPerQuantity > 1) {
          const guestNumber = (i % unitsPerQuantity) + 1;
          attendeeName = `${attendeeName} (Guest ${guestNumber})`;
        }

        const attendeeEmail = (attendee?.email || order.customerEmail).toLowerCase();
        const customData = attendee?.customData || {};

        let ticket: TicketDocument | null = null;
        let attempt = 0;
        while (!ticket && attempt < 6) {
          attempt++;
          const ticketNumber = this.generateTicketNumber(
            item.tierName,
            nextIndex,
            attendee?.departmentCode || dept,
            eventCode,
          );
          const qrCodeHash = crypto
            .createHash('sha256')
            .update(`${order._id}-${ticketNumber}-${Date.now()}-${Math.random()}`)
            .digest('hex');

          try {
            ticket = await this.ticketModel.create({
              tenantId: order.tenantId,
              eventId: order.eventId,
              orderId: order._id.toString(),
              tierId: item.tierId,
              ticketNumber,
              departmentCode: attendee?.departmentCode || dept,
              customData,
              attendeeName,
              attendeeEmail,
              originalAttendeeEmail: attendeeEmail,
              qrCodeHash,
              status: TicketStatus.ISSUED,
              isComplimentary: order.paymentMethod === 'INTERNAL_ISSUANCE',
            });
          } catch (err: any) {
            if (err?.code === 11000) {
              nextIndex++;
              continue;
            }
            throw err;
          }
        }
        if (!ticket) throw new ConflictException('Could not allocate a unique ticket number');
        nextIndex++;

        await this.sendTicketEmail(ticket, event, tenant, walletUrl);
      }
    }

    // Release the inventory hold exactly once, even across retries.
    if (order.reservationState === 'HELD') {
      for (const item of order.items) {
        const units = item.reservedUnits || item.quantity;
        await this.releaseUnits(item.tierId.toString(), units);
      }
      order.reservationState = 'CONSUMED';
      await order.save();
    }

    const expected = order.items.reduce(
      (sum, item) => sum + (item.reservedUnits || item.quantity),
      0,
    );
    const finalCount = await this.ticketModel.countDocuments({
      orderId: order._id.toString(),
    });
    if (finalCount < expected) {
      this.logger.error(
        `Ticket generation incomplete for ${order.orderNumber}: ${finalCount}/${expected}`,
      );
      throw new ConflictException(
        'Some tickets could not be issued. The system will retry automatically — please check your wallet shortly.',
      );
    }

    if (tenant?.notificationEmails?.length) {
      try {
        const details = order.items
          .map((item) => `- ${item.quantity}x ${item.tierName}`)
          .join('\n');
        await this.resendService.sendOrderNotificationToAdmins({
          emails: tenant.notificationEmails,
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          orderNumber: order.orderNumber,
          totalAmount: order.totalAmount,
          eventName: event.title,
          ticketDetails: details,
        });
      } catch (err) {
        this.logger.warn(`Admin notification failed for ${order.orderNumber}`, err as any);
      }
    }
  }

  private async sendTicketEmail(
    ticket: TicketDocument,
    event: EventDocument,
    tenant: TenantDocument | null,
    walletUrl: string,
  ) {
    if (!ticket.attendeeEmail) return;
    try {
      const tier = await this.ticketTierModel.findById(ticket.tierId);
      const adminDomain =
        tenant && tenant.slug ? `admin-${tenant.slug}.ticketr.org` : 'admin.ticketr.org';
      const qrCodeUrl = `https://${adminDomain}/admin/verify/${ticket.qrCodeHash}`;
      const qrCodeDelivery = (event as any).qrCodeDelivery || 'STAMP_ON_TICKET';

      let ticketImageBuffer: Buffer | undefined;
      let ticketPdfBuffer: Buffer | undefined;
      let customImageUrl = tier?.templateImageUrl || '';

      if (customImageUrl && qrCodeDelivery === 'STAMP_ON_TICKET') {
        try {
          ticketImageBuffer = await this.ticketGeneratorService.generateTicketImage({
            templateImageUrl: customImageUrl,
            attendeeName: ticket.attendeeName || 'Guest',
            ticketNumber: ticket.ticketNumber,
            qrCodeHash: qrCodeUrl,
          });
          ticketPdfBuffer = await this.ticketGeneratorService.generateTicketPdf({
            ticketImageBuffer,
            attendeeName: ticket.attendeeName || 'Guest',
            eventName: event.title,
            eventDate: new Date(event.startDate).toLocaleString(),
            eventLocation: event.location,
            ticketNumber: ticket.ticketNumber,
            tierName: tier?.name || 'Standard',
          });
          customImageUrl = '';
        } catch (err) {
          this.logger.warn(`Ticket artwork failed for ${ticket.ticketNumber}`, err as any);
        }
      }

      await this.resendService.sendTicketEmail({
        toEmail: ticket.attendeeEmail,
        customerName: ticket.attendeeName || 'Guest',
        eventName: event.title,
        eventDate: new Date(event.startDate).toLocaleString(),
        eventLocation: event.location,
        ticketNumber: ticket.ticketNumber,
        tierName: tier?.name || 'Standard',
        qrCodeHash: qrCodeUrl,
        ticketImageUrl: customImageUrl,
        ticketImageBuffer,
        ticketPdfBuffer,
        qrCodeDelivery,
        walletUrl,
      });
      ticket.emailSent = true;
      await ticket.save();
    } catch (err) {
      this.logger.error(`Ticket email failed for ${ticket._id}`, err as any);
      ticket.emailSent = false;
      await ticket.save();
    }
  }

  // ---------------------------------------------------------------------------
  // Payments beyond the initial charge
  // ---------------------------------------------------------------------------

  /**
   * Full refund of a paid order. Gateway refunds are executed immediately;
   * manual-transfer refunds must be explicitly confirmed by the organizer.
   * Tickets are cancelled, upcoming inventory is returned and any un-settled
   * payout allocation is reduced so the same money cannot be paid out twice.
   */
  async refundOrder(
    orderId: string,
    adminUserId: string,
    dto: { reason: string; manual?: boolean },
    tenantId?: string,
  ) {
    const order = await this.findOrderForTenant(orderId, tenantId);
    if (order.status === OrderStatus.REFUNDED || order.refundedAt) {
      throw new BadRequestException('This order has already been refunded');
    }
    if (order.status !== OrderStatus.PAID) {
      throw new BadRequestException('Only fully paid orders can be refunded');
    }
    if (!dto.reason?.trim()) {
      throw new BadRequestException('A refund reason is required');
    }

    const refundAmount = Math.round((order.amountPaid || order.totalAmount || 0) * 100) / 100;
    if (refundAmount <= 0) {
      throw new BadRequestException('There is no paid amount to refund on this order');
    }

    const tickets = await this.ticketModel.find({ orderId: order._id.toString() });
    if (tickets.some((ticket) => ticket.status === TicketStatus.CHECKED_IN)) {
      throw new BadRequestException(
        'This order has tickets that were already used at the gate and cannot be refunded',
      );
    }

    let payoutToAdjust: PayoutDocument | null = null;
    if (order.payoutId) {
      payoutToAdjust = await this.payoutModel.findById(order.payoutId);
      if (payoutToAdjust?.status === PayoutStatus.PAID) {
        throw new BadRequestException(
          'This order has already been settled to the organizer. Refund it offline and record a manual adjustment.',
        );
      }
    }

    let refundReference = `MANUAL-${Date.now().toString(36).toUpperCase()}`;
    let refundMethod: 'PAYSTACK' | 'MANUAL' = 'MANUAL';

    if (order.paymentMethod === 'PAYSTACK' && order.paystackReference) {
      const result = await this.paystackService.refundTransaction(
        order.paystackReference,
        Math.round(refundAmount * 100),
      );
      refundMethod = 'PAYSTACK';
      refundReference =
        (result as any)?.data?.refund_reference ||
        (result as any)?.data?.reference ||
        `PAYSTACK-${Date.now().toString(36).toUpperCase()}`;
    } else {
      if (!dto.manual) {
        throw new BadRequestException(
          'This order was paid outside the gateway. Confirm the manual refund to continue.',
        );
      }
      refundMethod = 'MANUAL';
    }

    if (payoutToAdjust && [PayoutStatus.PENDING, PayoutStatus.PROCESSING].includes(payoutToAdjust.status)) {
      const reduction = order.netToOrganizer ?? Math.max(0, order.totalAmount - (order.platformFee || 0));
      payoutToAdjust.amount = Math.max(
        0,
        Math.round((payoutToAdjust.amount - reduction) * 100) / 100,
      );
      payoutToAdjust.orderCount = Math.max(0, (payoutToAdjust.orderCount || 0) - 1);
      payoutToAdjust.orderIds = (payoutToAdjust.orderIds || []).filter(
        (id) => id.toString() !== order._id.toString(),
      );
      if (payoutToAdjust.amount <= 0) {
        payoutToAdjust.status = PayoutStatus.CANCELLED;
        payoutToAdjust.failureReason = 'All orders in this payout were refunded';
      }
      await payoutToAdjust.save();
    }
    order.payoutId = undefined;

    // Cancelling unused tickets keeps the gate honest even if a PDF was printed.
    for (const ticket of tickets) {
      if (ticket.status === TicketStatus.ISSUED) {
        ticket.status = TicketStatus.CANCELLED;
        await ticket.save();
      }
    }

    // Return seats to inventory only while the event is still upcoming.
    const event = await this.eventModel.findById(order.eventId);
    if (event && new Date(event.startDate).getTime() > Date.now()) {
      for (const ticket of tickets) {
        await this.ticketTierModel.updateOne(
          { _id: ticket.tierId, soldCount: { $gt: 0 } },
          { $inc: { soldCount: -1 } },
        );
      }
    }

    order.status = OrderStatus.REFUNDED;
    order.refundedAt = new Date();
    order.refundAmount = refundAmount;
    order.refundReason = dto.reason.trim();
    order.refundReference = refundReference;
    order.refundMethod = refundMethod;
    order.refundedBy = adminUserId;
    order.netToOrganizer = 0;
    order.platformFee = 0;
    order.amountRemaining = 0;
    await order.save();

    try {
      await this.resendService.sendRefundEmail({
        toEmail: order.customerEmail,
        customerName: order.customerName,
        eventName: event?.title || 'your event',
        orderNumber: order.orderNumber,
        amount: refundAmount,
        reason: dto.reason.trim(),
        reference: refundReference,
      });
    } catch (err) {
      this.logger.warn(`Refund email failed for ${order.orderNumber}`, err as any);
    }

    return this.getOrderSummary(order._id.toString());
  }

  async initializeBalancePayment(orderId: string, callbackUrl: string) {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== OrderStatus.PARTIALLY_PAID) {
      throw new BadRequestException('This order does not have an outstanding balance');
    }
    if (!order.amountRemaining || order.amountRemaining <= 0) {
      throw new BadRequestException('This order is already fully paid');
    }

    const reference = `BAL-${order.orderNumber}-${Date.now().toString(36)}`;
    const resp = await this.paystackService.initializeTransaction({
      email: order.customerEmail,
      amountInKobo: Math.round(order.amountRemaining * 100),
      reference,
      callbackUrl,
      metadata: { orderId: order._id.toString(), type: 'BALANCE' },
    });

    order.balancePaymentReference = reference;
    await order.save();
    return { authorizationUrl: resp.authorization_url, reference, amount: order.amountRemaining };
  }

  async uploadProofOfPayment(orderId: string, tenantId: string, file: Express.Multer.File) {
    const order = await this.orderModel.findOne({ _id: orderId, tenantId });
    if (!order) throw new NotFoundException('Order not found');
    if (![OrderStatus.PENDING, OrderStatus.AWAITING_APPROVAL].includes(order.status)) {
      throw new BadRequestException('Order is not in a pending state');
    }
    if (!file) throw new BadRequestException('No proof of payment file provided');
    if (!/^image\/(png|jpe?g|webp)|^application\/pdf$/.test(file.mimetype)) {
      throw new BadRequestException('Proof of payment must be a JPG, PNG, WEBP or PDF file');
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new BadRequestException('Proof of payment must be smaller than 10MB');
    }

    let proofOfPaymentUrl = '';
    try {
      proofOfPaymentUrl = await this.cloudinaryService.uploadImage(file, 'ticketr/receipts');
    } catch (err) {
      this.logger.error('Cloudinary receipt upload failed', err as any);
      throw new BadRequestException('We could not store that receipt. Please try again.');
    }

    order.proofOfPaymentUrl = proofOfPaymentUrl;
    order.checkoutStep = 'PROOF_UPLOADED';
    order.status = OrderStatus.AWAITING_APPROVAL;
    order.reservationExpiresAt = undefined;
    await order.save();
    return order;
  }

  async forceApproveOrder(
    orderId: string,
    adminUserId: string,
    dto: { reason: string; bankReference: string },
    file?: Express.Multer.File,
    tenantId?: string,
  ) {
    const order = await this.findOrderForTenant(orderId, tenantId);
    if (![OrderStatus.PENDING, OrderStatus.AWAITING_APPROVAL].includes(order.status)) {
      throw new BadRequestException('Order is not pending or awaiting approval');
    }
    if (!dto.bankReference?.trim()) {
      throw new BadRequestException('Bank transaction reference / session ID is required');
    }
    if (!dto.reason?.trim()) {
      throw new BadRequestException('A verification note is required to mark an order paid');
    }

    const trimmedBankRef = dto.bankReference.trim();
    const escaped = trimmedBankRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const duplicate = await this.orderModel.findOne({
      _id: { $ne: order._id },
      bankReference: { $regex: new RegExp(`^${escaped}$`, 'i') },
      status: { $in: [OrderStatus.PAID, OrderStatus.AWAITING_APPROVAL] },
    });
    if (duplicate) {
      throw new BadRequestException(
        `This bank reference was already used for order #${duplicate.orderNumber}. Duplicate payments are blocked.`,
      );
    }

    if (!file && !order.proofOfPaymentUrl) {
      throw new BadRequestException('A payment receipt is required to mark an order paid');
    }

    if (file) {
      try {
        order.proofOfPaymentUrl = await this.cloudinaryService.uploadImage(
          file,
          'ticketr/receipts',
        );
      } catch {
        throw new BadRequestException('We could not store that receipt. Please try again.');
      }
    }

    order.bankReference = trimmedBankRef;
    order.approvedBy = adminUserId;
    order.paymentMethod = 'MANUAL_TRANSFER';
    order.forceApproveReason = dto.reason.trim();
    order.checkoutStep = 'APPROVED';
    await order.save();

    return this.verifyAndFulfillOrder(`FORCE-PAID-${order.orderNumber}`);
  }

  async approveOrder(orderId: string, adminUserId: string, tenantId?: string) {
    const order = await this.findOrderForTenant(orderId, tenantId);
    if (order.status !== OrderStatus.AWAITING_APPROVAL) {
      throw new BadRequestException('Order is not awaiting approval');
    }
    if (!order.bankReference) {
      throw new BadRequestException(
        'A bank reference must be recorded before approving. Use “Mark as paid” to capture it.',
      );
    }
    order.approvedBy = adminUserId;
    await order.save();
    return this.verifyAndFulfillOrder(`FORCE-PAID-${order.orderNumber}`);
  }

  async rejectOrder(orderId: string, adminUserId: string, reason?: string, tenantId?: string) {
    const order = await this.findOrderForTenant(orderId, tenantId);
    if (![OrderStatus.AWAITING_APPROVAL, OrderStatus.PENDING].includes(order.status)) {
      throw new BadRequestException('Only pending orders can be rejected');
    }
    order.status = OrderStatus.CANCELLED;
    order.approvedBy = adminUserId;
    await this.releaseOrderReservation(order, reason || 'Rejected by organizer');
    await this.restorePromoUsage(order);
    await order.save();
    return { success: true, status: order.status };
  }

  async deleteOrder(orderId: string, adminUserId: string, tenantId?: string) {
    const order = await this.findOrderForTenant(orderId, tenantId);
    if (order.status === OrderStatus.PAID) {
      throw new BadRequestException(
        'Paid orders cannot be deleted because they are part of your financial ledger.',
      );
    }

    const tickets = await this.ticketModel.find({ orderId: order._id.toString() });
    if (tickets.some((t) => t.status === TicketStatus.CHECKED_IN)) {
      throw new BadRequestException('Tickets from this order have already been used at the gate');
    }

    if (order.reservationState === 'HELD') {
      await this.releaseOrderReservation(order, 'Order deleted by organizer');
    }

    for (const ticket of tickets) {
      await this.ticketTierModel.updateOne(
        { _id: ticket.tierId, soldCount: { $gt: 0 } },
        { $inc: { soldCount: -1 } },
      );
      await this.ticketModel.deleteOne({ _id: ticket._id });
    }

    await this.restorePromoUsage(order);
    await this.orderModel.deleteOne({ _id: order._id });
    void adminUserId;
    return { success: true, message: 'Order deleted and inventory returned' };
  }

  private async restorePromoUsage(order: OrderDocument) {
    if (!order.promoCode) return;
    await this.eventModel.updateOne(
      { _id: order.eventId, 'promoCodes.code': order.promoCode, 'promoCodes.usedCount': { $gt: 0 } },
      { $inc: { 'promoCodes.$.usedCount': -1 } },
    );
  }

  // ---------------------------------------------------------------------------
  // Wallet (secure buyer access)
  // ---------------------------------------------------------------------------

  async getWallet(token: string) {
    if (!token || token.length < 32) throw new BadRequestException('Invalid wallet link');
    const orders = await this.orderModel
      .find({ walletToken: token })
      .populate('eventId')
      .populate('tenantId')
      .sort({ createdAt: -1 })
      .exec();

    if (!orders.length) throw new NotFoundException('This wallet link is invalid or has expired');

    return Promise.all(
      orders.map(async (order) => {
        const tickets = await this.ticketModel
          .find({ orderId: order._id.toString() })
          .populate('tierId')
          .sort({ createdAt: 1 })
          .exec();
        return {
          orderId: order._id.toString(),
          orderNumber: order.orderNumber,
          status: order.status,
          totalAmount: order.totalAmount,
          amountPaid: order.amountPaid,
          amountRemaining: order.amountRemaining,
          paidAt: order.paidAt,
          createdAt: (order as any).createdAt,
          paymentMethod: order.paymentMethod,
          refundedAt: order.refundedAt,
          refundAmount: order.refundAmount,
          refundReference: order.refundReference,
          event: this.serializeEvent(order.eventId as any),
          tenant: order.tenantId
            ? { name: (order.tenantId as any).name, slug: (order.tenantId as any).slug }
            : null,
          tickets: tickets.map((ticket) => ({
            id: ticket._id.toString(),
            ticketNumber: ticket.ticketNumber,
            attendeeName: ticket.attendeeName,
            attendeeEmail: ticket.attendeeEmail,
            departmentCode: ticket.departmentCode,
            status: ticket.status,
            checkedInAt: ticket.checkedInAt,
            tier: (ticket.tierId as any)?.name,
            tierPrice: (ticket.tierId as any)?.price ?? 0,
            hasPdfTemplate: !!(ticket.tierId as any)?.templateImageUrl,
            isResaleable: ticket.isResaleable,
            transferCount: ticket.transferCount || 0,
            qrCodeHash: ticket.qrCodeHash,
          })),
        };
      }),
    );
  }

  /**
   * Enumeration-safe retrieval: always the same response, private link by email.
   */
  async requestWalletLink(email: string) {
    const normalized = (email || '').toLowerCase().trim();
    if (!normalized) throw new BadRequestException('Email address is required');

    const orders = await this.orderModel
      .find({ customerEmail: normalized, status: OrderStatus.PAID })
      .populate('eventId')
      .sort({ createdAt: -1 })
      .limit(10)
      .exec();

    const frontend = (process.env.FRONTEND_URL || 'http://localhost:3002').replace(/\/+$/, '');
    let devLink: string | undefined;

    if (orders.length) {
      const links = orders
        .slice(0, 3)
        .map(
          (order) =>
            `• ${(order.eventId as any)?.title || 'Your event'} — ${frontend}/my-tickets?token=${order.walletToken}`,
        )
        .join('<br/>');

      try {
        await this.resendService.sendEmail(
          normalized,
          'Your Ticketr ticket wallet',
          `<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:auto;padding:32px">
            <h2 style="color:#0B1F1A">Your tickets are ready</h2>
            <p style="color:#475569;line-height:1.6">Use your private links below to view QR codes, transfer a ticket or download a pass. Never share these links — they are the keys to your tickets.</p>
            <div style="background:#F6F7F2;border-radius:16px;padding:20px;margin:24px 0;color:#0B1F1A;line-height:2">${links}</div>
            <p style="color:#94a3b8;font-size:12px">If you didn't request this, you can safely ignore this email.</p>
          </div>`,
        );
      } catch (err) {
        this.logger.warn(`Wallet link email failed for ${normalized}`, err as any);
      }

      devLink = `${frontend}/my-tickets?token=${orders[0].walletToken}`;
    }

    return {
      message:
        'If that email has tickets, a private link is on its way. Check your inbox and spam folder.',
      ...(process.env.NODE_ENV !== 'production' ? { devLink } : {}),
    };
  }

  async lookupCustomerOrders(email: string) {
    // Deprecated public endpoint, kept as a safe alias for older clients.
    return this.requestWalletLink(email);
  }

  // ---------------------------------------------------------------------------
  // Read APIs
  // ---------------------------------------------------------------------------

  async getActiveSession(eventId: string, email: string) {
    if (!eventId || !email) return null;
    const normalizedEmail = email.toLowerCase().trim();

    const paidOrder = await this.orderModel.findOne({
      eventId,
      customerEmail: normalizedEmail,
      status: OrderStatus.PAID,
    });
    if (paidOrder) {
      return {
        status: 'PAID',
        isAlreadyPaid: true,
        orderId: paidOrder._id.toString(),
        orderNumber: paidOrder.orderNumber,
        customerName: paidOrder.customerName,
        customerEmail: paidOrder.customerEmail,
        totalAmount: paidOrder.totalAmount,
        paidAt: paidOrder.paidAt,
        message: `You already have a confirmed ticket (order #${paidOrder.orderNumber}) for this event.`,
      };
    }

    const pendingOrder = await this.orderModel.findOne({
      eventId,
      customerEmail: normalizedEmail,
      status: { $in: [OrderStatus.PENDING, OrderStatus.AWAITING_APPROVAL] },
    });

    if (!pendingOrder) return null;

    const tenant = await this.tenantModel.findById(pendingOrder.tenantId);
    return {
      hasPendingSession: true,
      status: pendingOrder.status,
      orderId: pendingOrder._id.toString(),
      orderNumber: pendingOrder.orderNumber,
      customerName: pendingOrder.customerName,
      customerEmail: pendingOrder.customerEmail,
      departmentCode: pendingOrder.departmentCode,
      items: pendingOrder.items,
      totalAmount: pendingOrder.totalAmount,
      checkoutStep:
        pendingOrder.checkoutStep ||
        (pendingOrder.status === OrderStatus.AWAITING_APPROVAL
          ? 'PROOF_UPLOADED'
          : 'PAYMENT_PENDING'),
      proofOfPaymentUrl: pendingOrder.proofOfPaymentUrl,
      paymentMethod: pendingOrder.paymentMethod,
      remittanceAccount: tenant
        ? tenant.primaryRemittanceAccount || tenant.remittanceAccount
        : null,
      createdAt: (pendingOrder as any).createdAt,
    };
  }

  async getOrderSummary(orderId: string) {
    const order = await this.orderModel
      .findById(orderId)
      .populate('eventId')
      .populate('tenantId')
      .exec();
    if (!order) throw new NotFoundException('Order not found');

    const tickets = await this.ticketModel
      .find({ orderId: order._id.toString() })
      .populate('tierId')
      .sort({ createdAt: 1 })
      .exec();

    return {
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
      status: order.status,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      totalAmount: order.totalAmount,
      amountPaid: order.amountPaid,
      amountRemaining: order.amountRemaining,
      currency: order.currency,
      paidAt: order.paidAt,
      createdAt: (order as any).createdAt,
      paymentMethod: order.paymentMethod,
      walletToken: order.walletToken,
      refundedAt: order.refundedAt,
      refundAmount: order.refundAmount,
      refundReason: order.refundReason,
      refundReference: order.refundReference,
      refundMethod: order.refundMethod,
      event: this.serializeEvent(order.eventId as any),
      tenant: order.tenantId
        ? {
            id: (order.tenantId as any)._id?.toString(),
            name: (order.tenantId as any).name,
            slug: (order.tenantId as any).slug,
          }
        : null,
      tickets,
    };
  }

  private serializeEvent(event: any) {
    if (!event) return null;
    return {
      id: event._id?.toString(),
      title: event.title,
      slug: event.slug,
      startDate: event.startDate,
      endDate: event.endDate,
      location: event.location,
      isVirtual: event.isVirtual,
      bannerUrl: event.bannerUrl,
      status: event.status,
      resalePriceCapPercent: event.resalePriceCapPercent ?? 100,
      resaleEnabled: event.resaleEnabled !== false,
      transferPolicy: event.transferPolicy,
    };
  }

  async getTenantOrders(
    tenantId: string,
    page: number = 1,
    limit: number = 20,
    status?: string,
    departmentCode?: string,
    search?: string,
  ) {
    page = Math.max(1, Number(page) || 1);
    limit = Math.min(100, Math.max(1, Number(limit) || 20));

    const filter: any = { tenantId };
    if (status && status !== 'ALL') {
      if (status === 'AWAITING_APPROVAL') {
        filter.status = { $in: [OrderStatus.AWAITING_APPROVAL, OrderStatus.PENDING] };
      } else {
        filter.status = status;
      }
    }
    if (departmentCode && departmentCode !== 'ALL') filter.departmentCode = departmentCode;
    if (search?.trim()) {
      const escaped = search.trim().slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');
      filter.$or = [
        { customerName: rx },
        { customerEmail: rx },
        { orderNumber: rx },
        { bankReference: rx },
        { paystackReference: rx },
      ];
    }

    const skip = (page - 1) * limit;

    const [data, totalCount, statsRows, departmentRows] = await Promise.all([
      this.orderModel
        .find(filter)
        .select('-walletToken')
        .populate('eventId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.orderModel.countDocuments(filter),
      this.orderModel
        .find({ tenantId })
        .select('status totalAmount amountPaid amountRemaining channel')
        .lean()
        .exec(),
      this.orderModel.distinct('departmentCode', { tenantId }),
    ]);

    const paid = statsRows.filter(
      (o: any) => o.status === OrderStatus.PAID && o.channel !== 'RESALE',
    );
    const totalRevenue = paid.reduce((sum: number, o: any) => sum + (o.totalAmount || 0), 0);
    const refunded = statsRows.filter((o: any) => o.status === OrderStatus.REFUNDED);
    const refundedAmount = refunded.reduce(
      (sum: number, o: any) => sum + (o.refundAmount || o.amountPaid || 0),
      0,
    );
    const outstanding = statsRows
      .filter((o: any) => o.status === OrderStatus.PARTIALLY_PAID)
      .reduce((sum: number, o: any) => sum + (o.amountRemaining || 0), 0);

    return {
      data,
      metadata: {
        total: totalCount,
        page,
        limit,
        lastPage: Math.max(1, Math.ceil(totalCount / limit)),
        statistics: {
          totalOrders: statsRows.length,
          totalPaidOrders: paid.length,
          totalRevenue,
          totalPending: statsRows.filter((o: any) =>
            [OrderStatus.AWAITING_APPROVAL, OrderStatus.PENDING].includes(o.status),
          ).length,
          outstandingBalance: outstanding,
          refundedCount: refunded.length,
          refundedAmount,
          availableDepartments: ['ALL', ...(departmentRows || []).filter(Boolean).sort()],
        },
      },
    };
  }

  async getAllOrdersSuperAdmin() {
    return this.orderModel
      .find()
      .select('-walletToken')
      .populate('tenantId')
      .populate('eventId')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean()
      .exec();
  }

  async getOrdersByCustomerEmail(email: string) {
    return this.requestWalletLink(email);
  }

  async sendPaymentReminder(
    orderId: string,
    customSubject?: string,
    customMessage?: string,
    tenantId?: string,
  ) {
    const filter: any = { _id: orderId };
    if (tenantId) filter.tenantId = tenantId;
    const order = await this.orderModel.findOne(filter).populate('eventId');
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Reminders can only be sent for unpaid orders');
    }

    const event = order.eventId as any as EventDocument;
    const tenant = await this.tenantModel.findById(order.tenantId);
    const domain = tenant?.slug ? `${tenant.slug}.ticketr.org` : 'ticketr.org';
    const checkoutUrl = `https://${domain}/${event?.slug || ''}?tenant=${tenant?.slug || ''}`;

    await this.resendService.sendPaymentReminder({
      toEmail: order.customerEmail,
      customerName: order.customerName,
      eventName: event ? event.title : 'Your event',
      orderNumber: order.orderNumber,
      checkoutUrl,
      customSubject,
      customMessage,
    });

    return { success: true, message: 'Reminder sent' };
  }

  // ---------------------------------------------------------------------------
  // Internal (complimentary) tickets
  // ---------------------------------------------------------------------------

  async createInternalOrder(
    adminUserId: string,
    dto: {
      tenantId: string;
      eventId: string;
      customerName: string;
      customerEmail: string;
      departmentCode?: string;
      reason: string;
      tierId: string;
    },
  ) {
    const event = await this.eventModel.findById(dto.eventId);
    if (!event) throw new NotFoundException('Event not found');
    const tenant = await this.tenantModel.findById(dto.tenantId);
    if (!tenant) throw new NotFoundException('Organizer not found');
    if (!dto.reason?.trim())
      throw new BadRequestException('A reason is required for complimentary tickets');
    if (!dto.customerEmail) throw new BadRequestException('Attendee email is required');

    const tier = await this.ticketTierModel.findById(dto.tierId);
    if (!tier || !tier.isActive) throw new BadRequestException('Ticket tier is not available');

    await this.reserveUnits(tier._id.toString(), 1);

    const orderNumber = `CMP-${Date.now().toString(36).toUpperCase()}-${crypto
      .randomBytes(2)
      .toString('hex')
      .toUpperCase()}`;
    const walletToken = this.generateWalletToken();

    const order = await this.orderModel.create({
      tenantId: dto.tenantId,
      eventId: dto.eventId,
      orderNumber,
      customerName: dto.customerName.trim(),
      customerEmail: dto.customerEmail.toLowerCase().trim(),
      departmentCode: dto.departmentCode,
      items: [
        {
          tierId: tier._id.toString(),
          tierName: tier.name,
          unitPrice: Number(tier.price),
          quantity: 1,
          subtotal: Number(tier.price),
          markupAmount: 0,
          reservedUnits: 1,
          attendees: [
            {
              name: dto.customerName,
              email: dto.customerEmail,
              departmentCode: dto.departmentCode,
            },
          ],
        },
      ],
      totalAmount: 0,
      platformFee: 0,
      netToOrganizer: 0,
      currency: 'NGN',
      status: OrderStatus.PAID,
      paidAt: new Date(),
      checkoutStep: 'APPROVED',
      paymentMethod: 'INTERNAL_ISSUANCE',
      proofOfPaymentUrl: 'INTERNAL_ISSUANCE',
      bankReference: `INTERNAL-${orderNumber}`,
      approvedBy: adminUserId,
      forceApproveReason: dto.reason.trim(),
      walletToken,
      fulfillmentStatus: 'PENDING',
      reservationState: 'HELD',
      channel: 'INTERNAL',
      amountPaid: 0,
      amountRemaining: 0,
    });

    return this.verifyAndFulfillOrder(`FORCE-PAID-${order.orderNumber}`);
  }

  async resendOrderTickets(orderId: string, tenantId: string) {
    const order = await this.orderModel.findOne({ _id: orderId, tenantId });
    if (!order) throw new NotFoundException('Order not found');
    const event = await this.eventModel.findById(order.eventId);
    const tenant = await this.tenantModel.findById(order.tenantId);
    if (!event) throw new NotFoundException('Event not found');
    const walletUrl = `${(process.env.FRONTEND_URL || 'https://ticketr.org').replace(/\/+$/, '')}/my-tickets?token=${order.walletToken}`;

    const tickets = await this.ticketModel.find({ orderId: order._id.toString() });
    for (const ticket of tickets) {
      await this.sendTicketEmail(ticket, event, tenant, walletUrl);
    }
    return { success: true, resent: tickets.length };
  }
}
