import { Controller, Post, Get, Body, Param, Query, Headers, Request, BadRequestException, Patch, UploadedFile, UseInterceptors, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OrderService } from './order.service';
import { PaystackService } from '../paystack/paystack.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../schemas/user.schema';

@Controller('orders')
export class OrderController {
  constructor(
    private orderService: OrderService,
    private paystackService: PaystackService,
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
      items: body.items, // Ensure items includes attendees
      callbackUrl: body.callbackUrl,
    });
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
  @Patch('admin/:id/approve')
  async approveOrder(@Request() req, @Param('id') orderId: string) {
    return this.orderService.approveOrder(orderId, req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER)
  @Patch('admin/:id/reject')
  async rejectOrder(@Request() req, @Param('id') orderId: string) {
    return this.orderService.rejectOrder(orderId, req.user.userId);
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
