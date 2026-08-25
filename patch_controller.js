const fs = require('fs');
const file = 'src/order/order.controller.ts';
let content = fs.readFileSync(file, 'utf8');

const internalEndpoint = `
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
`;

content = content.replace("  @UseGuards(JwtAuthGuard, RolesGuard)\n  @Roles(UserRole.ORGANIZER)\n  @Post('admin/:id/remind')", internalEndpoint + "\n  @UseGuards(JwtAuthGuard, RolesGuard)\n  @Roles(UserRole.ORGANIZER)\n  @Post('admin/:id/remind')");
fs.writeFileSync(file, content);
console.log('patched order.controller.ts');
