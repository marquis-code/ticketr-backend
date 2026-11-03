import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Headers,
  Request,
  BadRequestException,
  ForbiddenException,
  Patch,
  Delete,
  UploadedFile,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { OrderService } from './order.service';
import { TicketService } from '../ticket/ticket.service';
import { PaystackService } from '../paystack/paystack.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../schemas/user.schema';

function withoutWalletToken<T extends Record<string, any>>(payload: T): Omit<T, 'walletToken'> {
  const { walletToken, ...rest } = payload || ({} as T);
  return rest;
}

@Controller('orders')
export class OrderController {
  constructor(
    private orderService: OrderService,
    private paystackService: PaystackService,
    private auditService: AuditService,
    private ticketService: TicketService,
  ) {}

  // ---------------------------------------------------------------------------
  // Public / buyer endpoints
  // ---------------------------------------------------------------------------

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  async createOrder(@Body() body: any) {
    if (!body?.eventId || !body?.tenantId || !Array.isArray(body?.items)) {
      throw new BadRequestException('eventId, tenantId and at least one item are required');
    }
    return this.orderService.createOrder({
      tenantId: body.tenantId,
      eventId: body.eventId,
      customerName: body.customerName,
      customerEmail: body.customerEmail,
      customerPhone: body.customerPhone,
      departmentCode: body.departmentCode,
      items: body.items,
      callbackUrl: body.callbackUrl,
      promoCode: body.promoCode,
      isInstallmentPlan: body.isInstallmentPlan === true,
      // NOTE: body.discountAmount is intentionally ignored. Discounts are always
      // recomputed from the event's promo codes on the server.
    });
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('validate-promo')
  async validatePromoCode(
    @Query('code') code: string,
    @Query('eventId') eventId: string,
  ) {
    if (!eventId) throw new BadRequestException('eventId is required');
    return this.orderService.validatePromoCode(code, eventId);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('active-session')
  async getActiveSession(@Query('eventId') eventId: string, @Query('email') email: string) {
    if (!eventId || !email) {
      throw new BadRequestException('eventId and email are required');
    }
    return this.orderService.getActiveSession(eventId, email);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('verify')
  async verifyOrder(@Query('reference') reference: string) {
    if (!reference) throw new BadRequestException('Transaction reference is required');
    return this.orderService.verifyAndFulfillOrder(reference);
  }

  /** Private wallet: the token is only ever delivered to the buyer's email. */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('wallet/:token')
  async getWallet(@Param('token') token: string) {
    return this.orderService.getWallet(token);
  }

  /** Enumeration-safe: emails a private link instead of returning tickets. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('wallet/request-link')
  async requestWalletLink(@Body('email') email: string) {
    if (!email) throw new BadRequestException('Email address is required');
    return this.orderService.requestWalletLink(email);
  }

  /** Backwards-compatible alias for older clients. Never returns ticket data. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Get('lookup')
  async lookupCustomerOrders(@Query('email') email: string) {
    if (!email) throw new BadRequestException('Email address is required');
    return this.orderService.lookupCustomerOrders(email);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/pay-balance')
  async payBalance(@Param('id') orderId: string, @Body('callbackUrl') callbackUrl: string) {
    if (!callbackUrl) throw new BadRequestException('callbackUrl is required');
    return this.orderService.initializeBalancePayment(orderId, callbackUrl);
  }

  @Post(':id/upload-proof')
  @UseInterceptors(FileInterceptor('receipt'))
  async uploadProofOfPayment(
    @Param('id') orderId: string,
    @Body('tenantId') tenantId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!tenantId) throw new BadRequestException('tenantId is required');
    if (!file) throw new BadRequestException('Receipt file is required');
    return this.orderService.uploadProofOfPayment(orderId, tenantId, file);
  }

  // Paystack calls this endpoint directly. It must always answer 200 quickly so
  // that Paystack does not retry indefinitely, and it is signature-verified
  // against the raw request bytes.
  @SkipThrottle()
  @Post('webhook/paystack')
  async handlePaystackWebhook(
    @Request() req: RawBodyRequest<any>,
    @Headers('x-paystack-signature') signature: string,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Webhook raw body unavailable');
    }
    const isValid = this.paystackService.verifyWebhookSignature(rawBody, signature);
    if (!isValid) throw new ForbiddenException('Invalid webhook signature');

    const body = req.body || {};
    try {
      if (body.event === 'charge.success') {
        const reference = body.data?.reference;
        const amount = Number(body.data?.amount || 0);
        const metadata = body.data?.metadata || {};
        if (reference) {
          if (metadata.type === 'RESALE' || String(reference).startsWith('RSL-')) {
            await this.ticketService.verifyResalePayment(reference);
          } else {
            await this.orderService.verifyAndFulfillOrder(reference, {
              verifiedAmountKobo: amount,
            });
          }
        }
      }
    } catch (err) {
      // Log but acknowledge: Paystack retries are handled idempotently.
      // eslint-disable-next-line no-console
      console.error('Paystack webhook processing error:', (err as Error)?.message);
    }
    return { status: 'success' };
  }

  // ---------------------------------------------------------------------------
  // Organizer endpoints
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Get('admin/my-orders')
  async getMyOrders(@Request() req) {
    if (!req.user.tenantId) {
      throw new BadRequestException('User must belong to a tenant');
    }
    return this.orderService.getTenantOrders(req.user.tenantId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Get('tenant')
  async getTenantOrders(
    @Request() req,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('departmentCode') departmentCode?: string,
    @Query('search') search?: string,
  ) {
    if (!req.user.tenantId) {
      throw new BadRequestException('User must belong to a tenant');
    }
    return this.orderService.getTenantOrders(
      req.user.tenantId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      status,
      departmentCode,
      search,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Get('superadmin/all')
  async getAllOrdersSuperAdmin() {
    return this.orderService.getAllOrdersSuperAdmin();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Patch('admin/:id/force-approve')
  @UseInterceptors(FileInterceptor('receipt'))
  async forceApproveOrder(
    @Request() req,
    @Param('id') orderId: string,
    @Body('reason') reason: string,
    @Body('bankReference') bankReference: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const result = await this.orderService.forceApproveOrder(
      orderId,
      req.user.userId,
      { reason, bankReference },
      file,
      req.user.role === UserRole.SUPER_ADMIN ? undefined : req.user.tenantId,
    );
    const safeResult = withoutWalletToken(result as any);
    await this.auditService.logAction({
      action: 'ORDER_FORCE_APPROVED',
      entity: 'Order',
      entityId: orderId,
      userId: req.user.userId,
      tenantId: req.user.tenantId,
      details: { reason, bankReference },
    });
    return safeResult;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  @Post('admin/internal-ticket')
  async createInternalTicket(@Request() req, @Body() body: any) {
    if (!req.user.tenantId) {
      throw new BadRequestException('User must belong to a tenant');
    }
    const result = await this.orderService.createInternalOrder(req.user.userId, {
      tenantId: req.user.tenantId,
      eventId: body.eventId,
      customerName: body.customerName,
      customerEmail: body.customerEmail,
      departmentCode: body.departmentCode,
      reason: body.reason,
      tierId: body.tierId,
    });
    return withoutWalletToken(result as any);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Post('admin/:id/remind')
  async remindOrder(@Request() req, @Param('id') orderId: string, @Body() body: any) {
    const result = await this.orderService.sendPaymentReminder(
      orderId,
      body?.customSubject,
      body?.customMessage,
      req.user.tenantId,
    );
    await this.auditService.logAction({
      action: 'ORDER_REMINDER_SENT',
      entity: 'Order',
      entityId: orderId,
      userId: req.user.userId,
      tenantId: req.user.tenantId,
    });
    return result;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Post('admin/:id/resend-tickets')
  async resendTickets(@Request() req, @Param('id') orderId: string) {
    return this.orderService.resendOrderTickets(orderId, req.user.tenantId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Patch('admin/:id/approve')
  async approveOrder(@Request() req, @Param('id') orderId: string) {
    const result = await this.orderService.approveOrder(orderId, req.user.userId, req.user.tenantId);
    const safeResult = withoutWalletToken(result as any);
    await this.auditService.logAction({
      action: 'ORDER_APPROVED',
      entity: 'Order',
      entityId: orderId,
      userId: req.user.userId,
      tenantId: req.user.tenantId,
    });
    return safeResult;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  @Post('admin/:id/refund')
  async refundOrder(
    @Request() req,
    @Param('id') orderId: string,
    @Body('reason') reason: string,
    @Body('manual') manual?: boolean,
  ) {
    const result = await this.orderService.refundOrder(
      orderId,
      req.user.userId,
      { reason, manual: !!manual },
      req.user.role === UserRole.SUPER_ADMIN ? undefined : req.user.tenantId,
    );
    const safeResult = withoutWalletToken(result as any);
    await this.auditService.logAction({
      action: 'ORDER_REFUNDED',
      entity: 'Order',
      entityId: orderId,
      userId: req.user.userId,
      tenantId: req.user.tenantId,
      details: { reason, manual: !!manual, refundMethod: result.refundMethod },
    });
    return safeResult;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Patch('admin/:id/reject')
  async rejectOrder(
    @Request() req,
    @Param('id') orderId: string,
    @Body('reason') reason?: string,
  ) {
    const result = await this.orderService.rejectOrder(
      orderId,
      req.user.userId,
      reason,
      req.user.role === UserRole.SUPER_ADMIN ? undefined : req.user.tenantId,
    );
    await this.auditService.logAction({
      action: 'ORDER_REJECTED',
      entity: 'Order',
      entityId: orderId,
      userId: req.user.userId,
      tenantId: req.user.tenantId,
      details: { reason },
    });
    return result;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  @Delete('admin/:id')
  async deleteOrder(@Request() req, @Param('id') orderId: string) {
    const result = await this.orderService.deleteOrder(
      orderId,
      req.user.userId,
      req.user.role === UserRole.SUPER_ADMIN ? undefined : req.user.tenantId,
    );
    await this.auditService.logAction({
      action: 'ORDER_DELETED',
      entity: 'Order',
      entityId: orderId,
      userId: req.user.userId,
      tenantId: req.user.tenantId,
    });
    return result;
  }

  /**
   * Order lookup by id requires the buyer's wallet token or a signed-in
   * organizer that owns the order. Without this, QR codes were public.
   */
  @Get(':id')
  async getOrder(@Param('id') id: string, @Query('token') token?: string) {
    if (!token) {
      throw new ForbiddenException('A private wallet token is required to view this order');
    }
    const wallet = await this.orderService.getWallet(token);
    const match = wallet.find((o: any) => o.orderId === id);
    if (!match) throw new ForbiddenException('This order does not belong to that wallet');
    return match;
  }
}
