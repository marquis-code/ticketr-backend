import { PayoutService } from './payout.service';
import { PayoutStatus } from '../schemas/payout.schema';

function makeService(): PayoutService {
  return new PayoutService(null as any, null as any, null as any);
}

describe('PayoutService invariants', () => {
  const service = makeService();

  it('falls back to total minus platform fee for legacy orders', () => {
    expect((service as any).orderNet({ totalAmount: 15000, platformFee: 750 })).toBe(14250);
    expect((service as any).orderNet({ totalAmount: 15000, platformFee: 750, netToOrganizer: 14000 })).toBe(14000);
    expect((service as any).orderNet({ totalAmount: 15000 })).toBe(15000);
  });

  it('allows a pending payout to move to paid', () => {
    expect(() =>
      (service as any).assertTransition(PayoutStatus.PENDING, PayoutStatus.PAID),
    ).not.toThrow();
  });

  it('blocks any change after settlement', () => {
    expect(() =>
      (service as any).assertTransition(PayoutStatus.PAID, PayoutStatus.FAILED),
    ).toThrow('cannot be changed');
  });

  it('blocks a closed payout from reopening', () => {
    expect(() =>
      (service as any).assertTransition(PayoutStatus.CANCELLED, PayoutStatus.PENDING),
    ).toThrow('already closed');
  });
});
