import { PaystackService } from './paystack.service';
import * as crypto from 'crypto';

function makeService(secret = 'sk_live_unit_test_secret'): PaystackService {
  const config = { get: (key: string) => (key === 'PAYSTACK_SECRET_KEY' ? secret : undefined) };
  return new PaystackService(config as any);
}

describe('PaystackService webhook signatures', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('rejects a missing signature header', () => {
    process.env.NODE_ENV = 'production';
    const service = makeService();
    expect(service.verifyWebhookSignature(Buffer.from('{}'), '')).toBe(false);
  });

  it('rejects a forged signature', () => {
    process.env.NODE_ENV = 'production';
    const service = makeService();
    expect(service.verifyWebhookSignature(Buffer.from('{"event":"charge.success"}'), 'deadbeef')).toBe(false);
  });

  it('accepts the HMAC of the exact raw body', () => {
    process.env.NODE_ENV = 'production';
    const secret = 'sk_live_unit_test_secret';
    const service = makeService(secret);
    const raw = Buffer.from('{"event":"charge.success","data":{"reference":"abc"}}');
    const signature = crypto.createHmac('sha512', secret).update(raw).digest('hex');
    expect(service.verifyWebhookSignature(raw, signature)).toBe(true);
  });

  it('does not accept a signature computed over different bytes', () => {
    process.env.NODE_ENV = 'production';
    const secret = 'sk_live_unit_test_secret';
    const service = makeService(secret);
    const signed = Buffer.from('{"amount":100}');
    const tampered = Buffer.from('{"amount":999999}');
    const signature = crypto.createHmac('sha512', secret).update(signed).digest('hex');
    expect(service.verifyWebhookSignature(tampered, signature)).toBe(false);
  });
});
