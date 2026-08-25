import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument, OrderStatus } from '../schemas/order.schema';
import { TicketTier, TicketTierDocument } from '../schemas/ticket-tier.schema';
import { Event, EventDocument, MarkupFeeType, MarkupStrategy } from '../schemas/event.schema';
import { Tenant, TenantDocument } from '../schemas/tenant.schema';
import { Ticket, TicketDocument, TicketStatus } from '../schemas/ticket.schema';
import { PaystackService } from '../paystack/paystack.service';
import { ResendService } from '../resend/resend.service';
import { RedisService } from '../redis/redis.service';
import { TicketGeneratorService } from '../ticket-generator/ticket-generator.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
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
    private cloudinaryService: CloudinaryService,
  ) {}

  async createOrder(dto: {
    tenantId: string;
    eventId: string;
    customerName: string;
    customerEmail: string;
    customerPhone?: string;
    departmentCode?: string;
    isInstallmentPlan?: boolean;
    promoCode?: string;
    discountAmount?: number;
    items: Array<{ tierId: string; quantity: number; attendees?: { name: string; email: string }[] }>;
    callbackUrl: string;
  }) {
    const event = await this.eventModel.findById(dto.eventId);
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    const tenant = await this.tenantModel.findById(dto.tenantId);
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    let totalAmount = 0;
    let totalMarkupAmount = 0;
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

      let itemMarkup = 0;
      if (tier.markupFee > 0) {
        if (tier.markupFeeType === MarkupFeeType.PERCENTAGE) {
          itemMarkup = (tier.markupFee / 100) * subtotal;
        } else {
          itemMarkup = tier.markupFee * item.quantity;
        }
      }

      if (itemMarkup > 0 && tier.markupStrategy === MarkupStrategy.ADD_TO_FEE) {
        totalAmount += itemMarkup;
        totalMarkupAmount += itemMarkup;
      } else if (itemMarkup > 0) {
        totalMarkupAmount += itemMarkup;
      }

      orderItems.push({
        tierId: tier._id.toString(),
        tierName: tier.name,
        unitPrice: tier.price,
        quantity: item.quantity,
        subtotal,
        attendees: item.attendees,
      });
    }

    // Apply discount if promo code was used
    const discountAmount = dto.discountAmount && dto.discountAmount > 0 ? Math.min(dto.discountAmount, totalAmount) : 0;
    const chargeableAmount = totalAmount - discountAmount;

    const normalizedEmail = dto.customerEmail.toLowerCase().trim();

    // 1. Check if customer already has a PAID order for this event
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
        message: `You already have a confirmed and paid ticket (Order #${existingPaidOrder.orderNumber}) for this event!`,
      };
    }

    // 2. Check if customer has an existing PENDING or AWAITING_APPROVAL order (Resume session to avoid duplicate orders!)
    const existingPendingOrder = await this.orderModel.findOne({
      eventId: dto.eventId,
      customerEmail: normalizedEmail,
      status: { $in: [OrderStatus.PENDING, OrderStatus.AWAITING_APPROVAL] },
    });

    if (existingPendingOrder) {
      // If proof was already uploaded and order is awaiting organizer approval
      if (existingPendingOrder.status === OrderStatus.AWAITING_APPROVAL) {
        return {
          resumedSession: true,
          isAwaitingApproval: true,
          orderId: existingPendingOrder._id.toString(),
          orderNumber: existingPendingOrder.orderNumber,
          totalAmount: existingPendingOrder.totalAmount,
          status: existingPendingOrder.status,
          checkoutStep: 'PROOF_UPLOADED',
          proofOfPaymentUrl: existingPendingOrder.proofOfPaymentUrl,
          paymentMethod: existingPendingOrder.paymentMethod,
          remittanceAccount: tenant.primaryRemittanceAccount || tenant.remittanceAccount,
          message: `You already have an order #${existingPendingOrder.orderNumber} with proof of payment awaiting organizer approval.`,
        };
      }

      // Resume & update the existing pending order session
      existingPendingOrder.customerName = dto.customerName;
      existingPendingOrder.customerPhone = dto.customerPhone;
      existingPendingOrder.departmentCode = dto.departmentCode;
      existingPendingOrder.items = orderItems;
      existingPendingOrder.totalAmount = chargeableAmount;
      existingPendingOrder.discountAmount = discountAmount;
      existingPendingOrder.promoCode = dto.promoCode;
      existingPendingOrder.checkoutStep = 'PAYMENT_PENDING';
      await existingPendingOrder.save();

      if (tenant.paymentMethod === 'MANUAL_TRANSFER') {
        return {
          resumedSession: true,
          orderId: existingPendingOrder._id.toString(),
          orderNumber: existingPendingOrder.orderNumber,
          totalAmount: existingPendingOrder.totalAmount,
          paymentMethod: 'MANUAL_TRANSFER',
          checkoutStep: 'PAYMENT_PENDING',
          remittanceAccount: tenant.primaryRemittanceAccount || tenant.remittanceAccount,
          message: `Resumed your existing order session #${existingPendingOrder.orderNumber}.`,
        };
      }

      // For Paystack, initialize transaction on existing order
      const paystackRef = existingPendingOrder.paystackReference || `REF-${existingPendingOrder.orderNumber}`;
      existingPendingOrder.paystackReference = paystackRef;
      const amountToCharge = dto.isInstallmentPlan ? chargeableAmount / 2 : chargeableAmount;
      const amountInKobo = Math.round(amountToCharge * 100);
      const paystackPayload: any = {
        email: normalizedEmail,
        amountInKobo,
        reference: `${paystackRef}-${Date.now().toString(36)}`,
        callbackUrl: dto.callbackUrl,
        subaccount: tenant?.paystackSubaccountCode || undefined,
        metadata: {
          orderId: existingPendingOrder._id.toString(),
          eventId: dto.eventId,
          tenantId: dto.tenantId,
          departmentCode: dto.departmentCode,
        },
      };

      if (totalMarkupAmount > 0) {
        paystackPayload.transaction_charge = Math.round(totalMarkupAmount * 100);
        paystackPayload.bearer = 'account';
      }

      const paystackResponse = await this.paystackService.initializeTransaction(paystackPayload);
      existingPendingOrder.paystackAccessCode = paystackResponse.access_code;
      await existingPendingOrder.save();

      return {
        resumedSession: true,
        orderId: existingPendingOrder._id.toString(),
        orderNumber: existingPendingOrder.orderNumber,
        totalAmount: existingPendingOrder.totalAmount,
        paymentMethod: 'PAYSTACK',
        authorizationUrl: paystackResponse.authorization_url,
        reference: paystackPayload.reference,
        message: `Resumed your existing order session #${existingPendingOrder.orderNumber}.`,
      };
    }

    // 3. Create fresh order if no previous session exists
    const orderNumber = `CMT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const paystackRef = `REF-${orderNumber}`;

    const order = await this.orderModel.create({
      tenantId: dto.tenantId,
      eventId: dto.eventId,
      orderNumber,
      customerName: dto.customerName,
      customerEmail: normalizedEmail,
      customerPhone: dto.customerPhone,
      departmentCode: dto.departmentCode,
      items: orderItems,
      totalAmount: chargeableAmount,
      currency: 'NGN',
      status: OrderStatus.PENDING,
      checkoutStep: 'PAYMENT_PENDING',
      isInstallmentPlan: dto.isInstallmentPlan || false,
      amountRemaining: dto.isInstallmentPlan ? chargeableAmount : 0,
      promoCode: dto.promoCode,
      discountAmount,
      paystackReference: tenant.paymentMethod === 'PAYSTACK' ? paystackRef : undefined,
      paymentMethod: tenant.paymentMethod || 'PAYSTACK',
    });

    if (tenant.paymentMethod === 'MANUAL_TRANSFER') {
      return {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        totalAmount: order.totalAmount,
        paymentMethod: 'MANUAL_TRANSFER',
        checkoutStep: 'PAYMENT_PENDING',
        remittanceAccount: tenant.primaryRemittanceAccount || tenant.remittanceAccount,
      };
    }

    // If installment plan, charge 50% upfront.
    const amountToCharge = dto.isInstallmentPlan ? chargeableAmount / 2 : chargeableAmount;
    const amountInKobo = Math.round(amountToCharge * 100);
    const paystackPayload: any = {
      email: normalizedEmail,
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
    };

    if (totalMarkupAmount > 0) {
      paystackPayload.transaction_charge = Math.round(totalMarkupAmount * 100);
      paystackPayload.bearer = 'account';
    }

    const paystackResponse = await this.paystackService.initializeTransaction(paystackPayload);

    order.paystackAccessCode = paystackResponse.access_code;
    await order.save();

    return {
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
      totalAmount: order.totalAmount,
      paymentMethod: 'PAYSTACK',
      authorizationUrl: paystackResponse.authorization_url,
      reference: paystackRef,
    };
  }

  async getActiveSession(eventId: string, email: string) {
    if (!eventId || !email) return null;
    const normalizedEmail = email.toLowerCase().trim();

    // 1. Check for paid order
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
        message: `You have an active confirmed ticket (#${paidOrder.orderNumber}) for this event!`,
      };
    }

    // 2. Check for active pending / awaiting approval order
    const pendingOrder = await this.orderModel.findOne({
      eventId,
      customerEmail: normalizedEmail,
      status: { $in: [OrderStatus.PENDING, OrderStatus.AWAITING_APPROVAL] },
    });

    if (pendingOrder) {
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
        checkoutStep: pendingOrder.checkoutStep || (pendingOrder.status === OrderStatus.AWAITING_APPROVAL ? 'PROOF_UPLOADED' : 'PAYMENT_PENDING'),
        proofOfPaymentUrl: pendingOrder.proofOfPaymentUrl,
        paymentMethod: pendingOrder.paymentMethod,
        remittanceAccount: tenant ? (tenant.primaryRemittanceAccount || tenant.remittanceAccount) : null,
        createdAt: (pendingOrder as any).createdAt,
      };
    }

    return null;
  }

  async uploadProofOfPayment(orderId: string, tenantId: string, file: Express.Multer.File) {
    const order = await this.orderModel.findOne({ _id: orderId, tenantId });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.status !== OrderStatus.PENDING && order.status !== OrderStatus.AWAITING_APPROVAL) {
      throw new BadRequestException('Order is not in a pending state');
    }

    if (!file) {
      throw new BadRequestException('No proof of payment file provided');
    }

    let proofOfPaymentUrl = '';
    try {
      proofOfPaymentUrl = await this.cloudinaryService.uploadImage(file, 'ticketr/receipts');
    } catch (err) {
      console.warn('Cloudinary upload failed, falling back to mock receipt URL', err.message);
      proofOfPaymentUrl = 'https://res.cloudinary.com/marquis/image/upload/v1723200000/ticketr/receipts/mock-receipt.png'; // Mock URL for testing offline
    }
    
    order.proofOfPaymentUrl = proofOfPaymentUrl;
    order.checkoutStep = 'PROOF_UPLOADED';
    order.status = OrderStatus.AWAITING_APPROVAL;
    await order.save();

    return order;
  }

  async forceApproveOrder(
    orderId: string,
    adminUserId: string,
    dto: { reason: string; bankReference: string },
    file?: Express.Multer.File,
  ) {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    
    if (order.status !== OrderStatus.PENDING && order.status !== OrderStatus.AWAITING_APPROVAL) {
      throw new BadRequestException('Order is not in pending or awaiting approval state');
    }

    if (!dto.bankReference || !dto.bankReference.trim()) {
      throw new BadRequestException('Bank Transaction Reference / Session ID is compulsory');
    }

    const trimmedBankRef = dto.bankReference.trim();

    // Prevent duplicate use of the same Bank Reference across paid/awaiting orders
    const existingOrderByRef = await this.orderModel.findOne({
      _id: { $ne: order._id },
      bankReference: { $regex: new RegExp(`^${trimmedBankRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      status: { $in: [OrderStatus.PAID, OrderStatus.AWAITING_APPROVAL] },
    });

    if (existingOrderByRef) {
      throw new BadRequestException(
        `This Bank Transaction Reference / Session ID ('${trimmedBankRef}') has already been used for order #${existingOrderByRef.orderNumber}. Duplicate payments are strictly prohibited.`,
      );
    }

    if (!file && !order.proofOfPaymentUrl) {
      throw new BadRequestException('Proof of payment receipt upload is compulsory to mark an order as paid');
    }

    let proofOfPaymentUrl = order.proofOfPaymentUrl;
    if (file) {
      try {
        proofOfPaymentUrl = await this.cloudinaryService.uploadImage(file, 'ticketr/receipts');
      } catch (err) {
        console.warn('Cloudinary upload failed, falling back to mock receipt URL', err.message);
        proofOfPaymentUrl = 'https://res.cloudinary.com/marquis/image/upload/v1723200000/ticketr/receipts/mock-receipt.png';
      }
    }

    order.proofOfPaymentUrl = proofOfPaymentUrl;
    order.bankReference = trimmedBankRef;
    order.approvedBy = adminUserId;
    order.paymentMethod = 'MANUAL_TRANSFER';
    if (dto.reason) order.forceApproveReason = dto.reason;
    await order.save();

    return this.verifyAndFulfillOrder(`FORCE-PAID-${order.paystackReference || order.orderNumber}`);
  }

  async sendPaymentReminder(orderId: string, customSubject?: string, customMessage?: string) {
    const order = await this.orderModel.findById(orderId).populate('eventId');
    if (!order) throw new NotFoundException('Order not found');
    
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Order is not in pending state');
    }

    const event = order.eventId as any as EventDocument;
    const tenant = await this.tenantModel.findById(order.tenantId);
    
    const domain = tenant && tenant.slug ? `${tenant.slug}.ticketr.org` : 'ticketr.org';
    const eventSlug = event && event.slug ? event.slug : '';
    const checkoutUrl = `https://${domain}/${eventSlug}`;

    await this.resendService.sendPaymentReminder({
      toEmail: order.customerEmail,
      customerName: order.customerName,
      eventName: event ? event.title : 'Ticketr Event',
      orderNumber: order.orderNumber,
      checkoutUrl,
      customSubject,
      customMessage,
    });

    return { success: true, message: 'Reminder sent' };
  }

  async approveOrder(orderId: string, adminUserId: string) {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    
    if (order.status !== OrderStatus.AWAITING_APPROVAL) {
      throw new BadRequestException('Order is not awaiting approval');
    }

    // Store who approved it, but do NOT set status to PAID yet.
    // verifyAndFulfillOrder will set PAID status AND handle ticket generation + email sending.
    // If we set PAID here, verifyAndFulfillOrder sees it as already fulfilled and skips everything.
    order.approvedBy = adminUserId;
    await order.save();

    // Call the fulfillment logic directly bypassing paystack verification
    return this.verifyAndFulfillOrder(`FORCE-PAID-${order.paystackReference || order.orderNumber}`);
  }

  async rejectOrder(orderId: string, adminUserId: string) {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    
    if (order.status !== OrderStatus.AWAITING_APPROVAL) {
      throw new BadRequestException('Order is not awaiting approval');
    }

    order.status = OrderStatus.FAILED;
    order.approvedBy = adminUserId;
    await order.save();

    return order;
  }

  async deleteOrder(orderId: string, adminUserId: string) {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    
    await this.orderModel.findByIdAndDelete(orderId);
    
    return { success: true, message: 'Order deleted successfully' };
  }

  async verifyAndFulfillOrder(reference: string) {
    const cleanRef = reference.replace('FORCE-PAID-', '');
    const order = await this.orderModel.findOne({
      $or: [
        { paystackReference: cleanRef },
        { orderNumber: cleanRef }
      ]
    });
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

    let paymentAmount = order.totalAmount;
    if (order.isInstallmentPlan) {
      paymentAmount = order.totalAmount / 2;
    }

    order.amountPaid = (order.amountPaid || 0) + paymentAmount;
    order.amountRemaining = order.totalAmount - order.amountPaid;
    
    if (order.amountRemaining > 0) {
      order.status = OrderStatus.PARTIALLY_PAID;
      order.nextPaymentDueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days later
    } else {
      order.status = OrderStatus.PAID;
      order.paidAt = new Date();
    }
    
    await order.save();
    
    // Only issue tickets if fully paid (or if you want to issue them partially paid, you can change this)
    if (order.status === OrderStatus.PARTIALLY_PAID) {
      return {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        status: order.status,
        amountPaid: order.amountPaid,
        amountRemaining: order.amountRemaining,
        message: 'Installment payment received successfully. Tickets will be issued upon full payment.'
      };
    }

    const tenant = await this.tenantModel.findById(order.tenantId).exec();

    let orderTotalAmount = order.totalAmount;
    const ticketDetailsList: string[] = [];

    const event = await this.eventModel.findById(order.eventId);
    const issuedTickets: any[] = [];

    for (const item of order.items) {
      ticketDetailsList.push(`- ${item.quantity}x ${item.tierName} (₦${item.subtotal.toLocaleString()})`);
      
      const tierDoc = await this.ticketTierModel.findById(item.tierId);
      let ticketsToGenerate = item.quantity;
      if (tierDoc?.isCoupleTicket) {
        ticketsToGenerate = item.quantity * 2;
      } else if (tierDoc?.name) {
        const match = tierDoc.name.match(/table\s+(?:of|for)?\s*(\d+)/i);
        if (match) {
          ticketsToGenerate = item.quantity * parseInt(match[1], 10);
        }
      }

      const updatedTierDoc = await this.ticketTierModel.findByIdAndUpdate(
        item.tierId,
        { $inc: { soldCount: ticketsToGenerate } },
        { new: true },
      );

      const currentSoldCount = updatedTierDoc ? updatedTierDoc.soldCount : ticketsToGenerate;
      const startTicketIndex = currentSoldCount - ticketsToGenerate + 1;

      for (let i = 0; i < ticketsToGenerate; i++) {
        const ticketIndex = startTicketIndex + i;

        const baseName = item.attendees && item.attendees[i] && item.attendees[i].name 
          ? item.attendees[i].name 
          : order.customerName;

        let attendeeName = baseName;
        if (tierDoc?.isCoupleTicket) {
          attendeeName = `${baseName} (${i % 2 === 0 ? 'Male' : 'Female'})`;
        } else if (ticketsToGenerate > 1 && item.quantity === 1) {
          attendeeName = `${baseName} (Guest ${i + 1})`;
        } else if (ticketsToGenerate > item.quantity) {
          // Fallback for multiple group tickets (e.g. 2 tables of 10)
          const guestNum = (i % (ticketsToGenerate / item.quantity)) + 1;
          attendeeName = `${baseName} (Guest ${guestNum})`;
        }

        const attendeeInfo = {
          name: attendeeName,
          email: item.attendees && item.attendees[i] ? item.attendees[i].email || order.customerEmail : order.customerEmail,
          departmentCode: item.attendees && item.attendees[i] ? item.attendees[i].departmentCode || order.departmentCode : order.departmentCode,
        };

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

        const adminDomain = tenant && tenant.slug ? `admin-${tenant.slug}.ticketr.org` : 'admin.ticketr.org';
        const qrCodeUrl = `https://${adminDomain}/verify/${qrCodeHash}`;

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
              qrCodeHash: qrCodeUrl,
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

        try {
          await this.resendService.sendTicketEmail({
            toEmail: attendeeInfo.email,
            customerName: attendeeInfo.name,
            eventName: event ? event.title : 'Event Ticket',
            eventDate: event ? new Date(event.startDate).toLocaleString() : '',
            eventLocation: event ? event.location : '',
            ticketNumber: formattedTicketCode,
            tierName: item.tierName,
            qrCodeHash: qrCodeUrl,
            ticketImageUrl: customImageUrl,
            ticketImageBuffer,
            ticketPdfBuffer,
          });
          ticket.emailSent = true;
          await ticket.save();
        } catch (emailErr) {
          this.logger.error(`Failed to send ticket email to ${attendeeInfo.email}`, emailErr);
          ticket.emailSent = false;
          await ticket.save();
        }
      }
    }

    if (tenant && tenant.notificationEmails && tenant.notificationEmails.length > 0) {
      try {
        await this.resendService.sendOrderNotificationToAdmins({
          emails: tenant.notificationEmails,
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          orderNumber: order.orderNumber,
          totalAmount: orderTotalAmount,
          eventName: 'Ticketr Event', // If you have event name logic here, we can improve it. But normally order has multiple items. We'll use the first event if available.
          ticketDetails: ticketDetailsList.join('\n'),
        });
      } catch (notifyErr) {
        this.logger.error(`Failed to send order notification to admins for order ${order.orderNumber}`, notifyErr);
      }
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
    const normalizedEmail = email.toLowerCase();
    
    // Find all tickets that belong to this email
    const attendeeTickets = await this.ticketModel.find({ attendeeEmail: normalizedEmail }).exec();
    const orderIdsFromTickets = attendeeTickets.map(t => t.orderId);

    // Find orders where they are either the customer OR they hold a ticket
    const orders = await this.orderModel
      .find({
        $or: [
          { customerEmail: normalizedEmail },
          { _id: { $in: orderIdsFromTickets } }
        ],
        status: OrderStatus.PAID
      })
      .populate('eventId')
      .sort({ createdAt: -1 })
      .exec();

    return Promise.all(
      orders.map(async (o) => {
        // Only return tickets that belong to the searcher, unless they are the buyer (then show all)
        const isBuyer = o.customerEmail === normalizedEmail;
        const tickets = await this.ticketModel.find({ 
          orderId: o._id.toString(),
          ...(isBuyer ? {} : { attendeeEmail: normalizedEmail }) 
        }).exec();
        
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

  
  async createInternalOrder(adminUserId: string, dto: {
    tenantId: string;
    eventId: string;
    customerName: string;
    customerEmail: string;
    departmentCode?: string;
    reason: string;
    tierId: string;
  }) {
    const event = await this.eventModel.findById(dto.eventId);
    if (!event) throw new NotFoundException('Event not found');
    const tenant = await this.tenantModel.findById(dto.tenantId);
    if (!tenant) throw new NotFoundException('Tenant not found');

    const tier = await this.ticketTierModel.findById(dto.tierId);
    if (!tier || !tier.isActive) throw new BadRequestException(`Ticket tier is not available`);

    const subtotal = tier.price;
    const orderItems = [{
      tierId: tier._id.toString(),
      tierName: tier.name,
      unitPrice: tier.price,
      quantity: 1,
      subtotal,
      attendees: [{ name: dto.customerName, email: dto.customerEmail, departmentCode: dto.departmentCode }]
    }];

    const normalizedEmail = dto.customerEmail.toLowerCase().trim();
    const orderNumber = `CMT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    
    const order = await this.orderModel.create({
      tenantId: dto.tenantId,
      eventId: dto.eventId,
      orderNumber,
      customerName: dto.customerName,
      customerEmail: normalizedEmail,
      departmentCode: dto.departmentCode,
      items: orderItems,
      totalAmount: subtotal, // It tracks revenue
      currency: 'NGN',
      status: OrderStatus.PENDING,
      checkoutStep: 'PROOF_UPLOADED',
      isInstallmentPlan: false,
      amountRemaining: subtotal,
      discountAmount: 0,
      paymentMethod: 'INTERNAL_ISSUANCE',
      proofOfPaymentUrl: 'INTERNAL_ISSUANCE',
      bankReference: `INTERNAL-${orderNumber}`,
      approvedBy: adminUserId,
      forceApproveReason: dto.reason
    });

    return this.verifyAndFulfillOrder(`FORCE-PAID-${order.orderNumber}`);
  }

  async validatePromoCode(code: string, eventId: string) {
    if (!code) {
      throw new BadRequestException('Promo code is required');
    }

    const event = await this.eventModel.findById(eventId);
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    // Check if event has promo codes defined (uses the promoCodes field on the Event schema)
    const promoCodes = (event as any).promoCodes || [];
    const normalizedCode = code.toUpperCase().trim();
    const matched = promoCodes.find(
      (p: any) => p.code.toUpperCase() === normalizedCode && p.isActive !== false,
    );

    if (!matched) {
      // Fallback: allow hardcoded EARLYBIRD code for backward compatibility
      if (normalizedCode === 'EARLYBIRD') {
        return { valid: true, code: 'EARLYBIRD', type: 'PERCENTAGE', value: 10 };
      }
      throw new BadRequestException('Invalid or expired promo code');
    }

    // Check expiry if set
    if (matched.expiresAt && new Date(matched.expiresAt) < new Date()) {
      throw new BadRequestException('This promo code has expired');
    }

    // Check usage limit
    if (matched.maxUses && matched.usedCount >= matched.maxUses) {
      throw new BadRequestException('This promo code has reached its usage limit');
    }

    return {
      valid: true,
      code: matched.code,
      type: matched.type || 'PERCENTAGE',
      value: matched.value || 10,
    };
  }
}
