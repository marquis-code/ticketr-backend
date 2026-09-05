import { Test, TestingModule } from '@nestjs/testing';
import { EmailLogController } from './email-log.controller';

describe('EmailLogController', () => {
  let controller: EmailLogController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmailLogController],
    }).compile();

    controller = module.get<EmailLogController>(EmailLogController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
