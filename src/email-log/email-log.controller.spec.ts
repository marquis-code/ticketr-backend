import { Test, TestingModule } from '@nestjs/testing';
import { EmailLogController } from './email-log.controller';
import { EmailLogService } from './email-log.service';

describe('EmailLogController', () => {
  let controller: EmailLogController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmailLogController],
      providers: [
        {
          provide: EmailLogService,
          useValue: {
            getLogs: jest.fn(),
            retryEmail: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<EmailLogController>(EmailLogController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
