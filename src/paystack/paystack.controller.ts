import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PaystackService } from './paystack.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../schemas/user.schema';

@Controller('paystack')
export class PaystackController {
  constructor(private readonly paystackService: PaystackService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  @Get('banks')
  async getBanks() {
    return this.paystackService.getBanks();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.SUPER_ADMIN)
  @Get('resolve-account')
  async resolveAccount(
    @Query('accountNumber') accountNumber: string,
    @Query('bankCode') bankCode: string,
  ) {
    return this.paystackService.resolveAccountNumber(accountNumber, bankCode);
  }
}
