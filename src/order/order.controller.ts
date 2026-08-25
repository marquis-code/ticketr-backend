import { Controller, Post, Get, Body, Param, Query, Headers, Request, BadRequestException, Patch, Delete, UploadedFile, UseInterceptors, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OrderService } from './order.service';
import { PaystackService } from '../paystack/paystack.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../schemas/user.schema';

@Controller('orders')
export class OrderController {
  constructor(
    private orderService: OrderService,
    private paystackService: PaystackService,
    private auditService: AuditService
  ) {}

  @Post()
  async createOrder(@Body() body: any) {
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
      discountAmount: body.discountAmount,
    });
  }

  @Get('validate-promo')
  async validatePromoCode(
    @Query('code') code: string,
    @Query('eventId') eventId: string,
  ) {
    return this.orderService.validatePromoCode(code, eventId);
  }

  @Get('active-session')
  async getActiveSession(
    @Query('eventId') eventId: string,
    @Query('email') email: string,
  ) {
    if (!eventId || !email) {
      throw new BadRequestException('eventId and email are required');
    }
    return this.orderService.getActiveSession(eventId, email);
  }

  @Get('verify')
  async verifyOrder(@Query('reference') reference: string) {
    if (!reference) {
      throw new BadRequestException('Transaction reference is required');
    }
    return this.orderService.verifyAndFulfillOrder(reference);
  }

  @Get('lookup')
  async lookupCustomerOrders(@Query('email') email: string) {
    if (!email) {
      throw new BadRequestException('Email address is required to lookup tickets');
    }
    return this.orderService.getOrdersByCustomerEmail(email);
  }

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
  async getTenantOrders(@Request() req) {
    if (!req.user.tenantId) {
      throw new BadRequestException('User must belong to a tenant');
    }
    return this.orderService.getTenantOrders(req.user.tenantId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @Get('superadmin/all')
  async getAllOrdersSuperAdmin() {
    return this.orderService.getAllOrdersSuperAdmin();
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
    try {
      return await this.orderService.uploadProofOfPayment(orderId, tenantId, file);
    } catch (error) {
      console.error("Upload proof error:", error);
      if (error.response) throw error;
      throw new BadRequestException(error.message || 'Error uploading proof');
    }
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
    if (!bankReference || !bankReference.trim()) {
      throw new BadRequestException('Bank Transaction Reference / Session ID is compulsory');
    }
    if (!reason || !reason.trim()) {
      throw new BadRequestException('Reason is compulsory to manually mark an order as paid');
    }
    const result = await this.orderService.forceApproveOrder(
      orderId,
      req.user.userId,
      { reason: reason.trim(), bankReference: bankReference.trim() },
      file,
    );
    await this.auditService.logAction({
      action: 'ORDER_FORCE_APPROVED',
      entity: 'Order',
      entityId: orderId,
      userId: req.user.userId,
      tenantId: req.user.tenantId,
      details: { reason: reason.trim(), bankReference: bankReference.trim() },
    });
    return result;
  }


  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  @Post('admin/internal-ticket')
  async createInternalTicket(@Request() req, @Body() body: any) {
    if (!req.user.tenantId) {
      throw new BadRequestException('User must belong to a tenant');
    }
    return this.orderService.createInternalOrder(req.user.userId, {
      tenantId: req.user.tenantId,
      eventId: body.eventId,
      customerName: body.customerName,
      customerEmail: body.customerEmail,
      departmentCode: body.departmentCode,
      reason: body.reason,
      tierId: body.tierId,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Post('admin/:id/remind')
  async remindOrder(@Request() req, @Param('id') orderId: string, @Body() body: { customSubject?: string; customMessage?: string }) {
    const result = await this.orderService.sendPaymentReminder(orderId, body?.customSubject, body?.customMessage);
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
  @Patch('admin/:id/approve')
  async approveOrder(@Request() req, @Param('id') orderId: string) {
    const result = await this.orderService.approveOrder(orderId, req.user.userId);
    await this.auditService.logAction({
      action: 'ORDER_APPROVED',
      entity: 'Order',
      entityId: orderId,
      userId: req.user.userId,
      tenantId: req.user.tenantId,
    });
    return result;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Patch('admin/:id/reject')
  async rejectOrder(@Request() req, @Param('id') orderId: string) {
    const result = await this.orderService.rejectOrder(orderId, req.user.userId);
    await this.auditService.logAction({
      action: 'ORDER_REJECTED',
      entity: 'Order',
      entityId: orderId,
      userId: req.user.userId,
      tenantId: req.user.tenantId,
    });
    return result;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  @Delete('admin/:id')
  async deleteOrder(@Request() req, @Param('id') orderId: string) {
    const result = await this.orderService.deleteOrder(orderId, req.user.userId);
    await this.auditService.logAction({
      action: 'ORDER_DELETED',
      entity: 'Order',
      entityId: orderId,
      userId: req.user.userId,
      tenantId: req.user.tenantId,
    });
    return result;
  }

  @Get(':id')
  async getOrder(@Param('id') id: string) {
    return this.orderService.getOrderSummary(id);
  }

  @Post('webhook/paystack')
  async handlePaystackWebhook(@Body() body: any, @Headers('x-paystack-signature') signature: string) {
    const isValid = this.paystackService.verifyWebhookSignature(JSON.stringify(body), signature);
    if (!isValid) {
      throw new BadRequestException('Invalid webhook signature');
    }

    if (body.event === 'charge.success') {
      const reference = body.data?.reference;
      if (reference) {
        await this.orderService.verifyAndFulfillOrder(reference);
      }
    }

    return { status: 'success' };
  }
}
