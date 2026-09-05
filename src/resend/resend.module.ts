import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ResendService } from './resend.service';
import { EmailLogModule } from '../email-log/email-log.module';

@Module({
  imports: [ConfigModule, forwardRef(() => EmailLogModule)],
  providers: [ResendService],
  exports: [ResendService],
})
export class ResendModule {}
