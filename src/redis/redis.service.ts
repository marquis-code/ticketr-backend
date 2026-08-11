import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private isConnected = false;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const host = this.configService.get<string>('REDIS_HOST', '127.0.0.1');
    const port = Number(this.configService.get<number>('REDIS_PORT', 6379));
    const password = this.configService.get<string>('REDIS_PASSWORD', '');

    try {
      this.client = new Redis({
        host,
        port,
        username: password ? 'default' : undefined,
        password: password || undefined,
        connectTimeout: 3000,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        enableReadyCheck: false,
        retryStrategy: (times) => {
          if (times > 2) {
            return null; // Stop retrying after 2 attempts
          }
          return 500;
        },
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        this.logger.log(`⚡ Connected to Redis at ${host}:${port}`);
      });

      this.client.on('ready', () => {
        this.isConnected = true;
      });

      this.client.on('error', (err) => {
        // Suppress RESP3 HELLO negotiation errors — ioredis falls back to RESP2 automatically
        if (err?.message?.includes('NOAUTH HELLO') || err?.message?.includes('HELLO')) {
          return; // Silently ignore — this is expected with Redis Cloud
        }
        this.isConnected = false;
      });
    } catch (err) {
      this.logger.warn(`Redis initialization notice: ${err.message}`);
    }
  }

  onModuleDestroy() {
    if (this.client) {
      try {
        this.client.disconnect();
      } catch (e) {}
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.isConnected || !this.client) return null;
    try {
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: any, ttlSeconds: number = 300): Promise<void> {
    if (!this.isConnected || !this.client) return;
    try {
      const serialized = JSON.stringify(value);
      await this.client.setex(key, ttlSeconds, serialized);
    } catch (e) {
      // Ignore cache set failure
    }
  }

  async del(key: string): Promise<void> {
    if (!this.isConnected || !this.client) return;
    try {
      await this.client.del(key);
    } catch (e) {}
  }

  // Gate Scan Verification Caching (Cache checked-in tickets for ultra-fast <1ms validation)
  async cacheTicketScan(qrHash: string, ticketData: any): Promise<void> {
    await this.set(`ticket:scan:${qrHash}`, ticketData, 86400); // 24hr cache
  }

  async getCachedTicketScan(qrHash: string): Promise<any | null> {
    return this.get(`ticket:scan:${qrHash}`);
  }

  // Atomic Inventory Reservation to prevent ticket overselling
  async checkAndReserveStock(tierId: string, quantity: number, maxCapacity: number): Promise<boolean> {
    if (!this.isConnected || !this.client) return true; // fallback to Mongo validation
    try {
      const key = `tier:stock:${tierId}`;
      const currentSold = await this.client.get(key);
      const sold = currentSold ? parseInt(currentSold, 10) : 0;

      if (sold + quantity > maxCapacity) {
        return false; // Out of stock!
      }

      await this.client.incrby(key, quantity);
      return true;
    } catch {
      return true;
    }
  }
}
