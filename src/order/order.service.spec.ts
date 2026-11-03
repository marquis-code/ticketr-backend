import { OrderService } from './order.service';
import { MarkupFeeType, MarkupStrategy } from '../schemas/event.schema';

/**
 * These helpers are the single source of truth for ticket units and buyer-facing
 * fees. They are exercised directly so pricing regressions fail in CI.
 */
function makeService(): OrderService {
  return new OrderService(
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
  );
}

describe('OrderService pricing helpers', () => {
  const service = makeService();

  it('issues one pass per unit for a standard tier', () => {
    expect(service.ticketUnitsPerQuantity({ name: 'Regular' })).toBe(1);
    expect(service.ticketUnitsPerQuantity(null)).toBe(1);
  });

  it('issues two passes for a couple ticket', () => {
    expect(service.ticketUnitsPerQuantity({ name: 'Couple', isCoupleTicket: true })).toBe(2);
  });

  it('reads the guest count from a table tier name', () => {
    expect(service.ticketUnitsPerQuantity({ name: 'VVIP (Table of 10)' })).toBe(10);
    expect(service.ticketUnitsPerQuantity({ name: 'Table for 6' })).toBe(6);
  });

  it('calculates a flat per-unit markup', () => {
    expect(
      service.calculateItemMarkup(30000, 2, {
        markupFee: 500,
        markupFeeType: MarkupFeeType.FLAT,
        markupStrategy: MarkupStrategy.ADD_TO_FEE,
      }),
    ).toBe(1000);
  });

  it('calculates a percentage markup on the subtotal', () => {
    expect(
      service.calculateItemMarkup(30000, 2, {
        markupFee: 2.5,
        markupFeeType: MarkupFeeType.PERCENTAGE,
      }),
    ).toBe(750);
  });

  it('never invents a fee when none is configured', () => {
    expect(service.calculateItemMarkup(30000, 2, {})).toBe(0);
  });
});
