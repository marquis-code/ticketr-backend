import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { EmailLogService } from './email-log.service';
import { EmailLog } from '../schemas/email-log.schema';
import { ResendService } from '../resend/resend.service';

describe('EmailLogService', () => {
  let service: EmailLogService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailLogService,
        { provide: getModelToken(EmailLog.name), useValue: {} },
        { provide: ResendService, useValue: { sendTicketEmail: jest.fn() } },
      ],
    }).compile();

    service = module.get<EmailLogService>(EmailLogService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
