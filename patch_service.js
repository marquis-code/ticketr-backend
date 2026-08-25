const fs = require('fs');
const file = 'src/order/order.service.ts';
let content = fs.readFileSync(file, 'utf8');

const internalMethod = `
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
    if (!tier || !tier.isActive) throw new BadRequestException(\`Ticket tier is not available\`);

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
    const orderNumber = \`CMT-\${Date.now().toString(36).toUpperCase()}-\${Math.random().toString(36).substring(2, 6).toUpperCase()}\`;
    
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
      bankReference: \`INTERNAL-\${orderNumber}\`,
      approvedBy: adminUserId,
      forceApproveReason: dto.reason
    });

    return this.verifyAndFulfillOrder(\`FORCE-PAID-\${order.orderNumber}\`);
  }

`;

content = content.replace('async validatePromoCode(code: string, eventId: string) {', internalMethod + '  async validatePromoCode(code: string, eventId: string) {');
fs.writeFileSync(file, content);
console.log('patched order.service.ts');
