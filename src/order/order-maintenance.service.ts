import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderService } from './order.service';

/**
 * Keeps inventory honest: expired checkout holds are released even if the buyer
 * simply closes the tab, so the next buyer sees real availability.
 */
@Injectable()
export class OrderMaintenanceService {
  private readonly logger = new Logger(OrderMaintenanceService.name);

  constructor(private readonly orderService: OrderService) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async releaseExpiredHolds() {
    try {
      const released = await this.orderService.releaseExpiredReservations();
      if (released > 0) {
        this.logger.log(`Released ${released} expired checkout reservation(s)`);
      }
    } catch (err) {
      this.logger.error('Failed to release expired reservations', err as any);
    }
  }
}
