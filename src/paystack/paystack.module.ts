import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaystackService } from './paystack.service';
import { PaystackController } from './paystack.controller';

@Module({
  imports: [ConfigModule],
  providers: [PaystackService],
  controllers: [PaystackController],
  exports: [PaystackService],
})
export class PaystackModule {}
