import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailLogService } from './email-log.service';
import { EmailLogController } from './email-log.controller';
import { EmailLog, EmailLogSchema } from '../schemas/email-log.schema';
import { ResendModule } from '../resend/resend.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: EmailLog.name, schema: EmailLogSchema }]),
    forwardRef(() => ResendModule)
  ],
  providers: [EmailLogService],
  controllers: [EmailLogController],
  exports: [EmailLogService],
})
export class EmailLogModule {}
