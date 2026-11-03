import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AuthModule } from './auth/auth.module';
import { TenantModule } from './tenant/tenant.module';
import { EventModule } from './event/event.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { PaystackModule } from './paystack/paystack.module';
import { ResendModule } from './resend/resend.module';
import { OrderModule } from './order/order.module';
import { TicketModule } from './ticket/ticket.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { RedisModule } from './redis/redis.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuditModule } from './audit/audit.module';
import { CommunicationsModule } from './communications/communications.module';
import { BullModule } from '@nestjs/bullmq';
import { SeedService } from './seed.service';
import { Tenant, TenantSchema } from './schemas/tenant.schema';
import { User, UserSchema } from './schemas/user.schema';
import { Event, EventSchema } from './schemas/event.schema';
import { TicketTier, TicketTierSchema } from './schemas/ticket-tier.schema';
import { University, UniversitySchema } from './schemas/university.schema';
import { ResaleListing, ResaleListingSchema } from './schemas/resale-listing.schema';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuditInterceptor } from './audit/audit.interceptor';

import { ScheduleModule } from '@nestjs/schedule';
import { EmailLogModule } from './email-log/email-log.module';
import { PayoutModule } from './payout/payout.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 120 },
    ]),
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config: Record<string, any>) => {
        if (config.NODE_ENV === 'production') {
          const required = ['MONGODB_URI', 'JWT_SECRET', 'PAYSTACK_SECRET_KEY', 'RESEND_API_KEY'];
          const missing = required.filter((key) => !config[key]);
          if (missing.length > 0) {
            throw new Error(`Missing required production configuration: ${missing.join(', ')}`);
          }
          if (
            config.JWT_SECRET === 'super_secret_jwt_key_ticketr_2026_change_in_prod' ||
            String(config.JWT_SECRET).length < 32
          ) {
            throw new Error('JWT_SECRET must be a unique value of at least 32 characters');
          }
          // Localhost links in production silently break ticket emails and wallet
          // access. Fail fast instead of shipping unusable tickets.
          const frontendUrl = String(config.FRONTEND_URL || '');
          if (!frontendUrl || /localhost|127\.0\.0\.1/.test(frontendUrl)) {
            throw new Error('FRONTEND_URL must be a public URL in production');
          }
        }
        return config;
      },
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const uri = configService.get<string>('MONGODB_URI');
        const isProduction = process.env.NODE_ENV === 'production';

        // NEVER silently boot an ephemeral in-memory database in production:
        // that turns every write into data loss on the next deploy.
        if (!uri) {
          if (isProduction) {
            throw new Error(
              'MONGODB_URI is required in production. Refusing to start with an in-memory database.',
            );
          }
          const mongod = await MongoMemoryServer.create();
          const memoryUri = mongod.getUri();
          console.warn(`🍃 No MONGODB_URI set — using throwaway in-memory Mongo at ${memoryUri}`);
          return { uri: memoryUri };
        }

        if (isProduction && /localhost:27017|127\.0\.0\.1:27017/.test(uri)) {
          throw new Error(
            'MONGODB_URI points at localhost in production. Refusing to start to avoid data loss.',
          );
        }

        return { uri };
      },
    }),
    MongooseModule.forFeature([
      { name: Tenant.name, schema: TenantSchema },
      { name: User.name, schema: UserSchema },
      { name: Event.name, schema: EventSchema },
      { name: TicketTier.name, schema: TicketTierSchema },
      { name: University.name, schema: UniversitySchema },
      { name: ResaleListing.name, schema: ResaleListingSchema },
    ]),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const password = configService.get<string>('REDIS_PASSWORD');
        return {
          connection: {
            host: configService.get('REDIS_HOST') || 'localhost',
            port: configService.get('REDIS_PORT') ? parseInt(configService.get<string>('REDIS_PORT') as string) : 6379,
            username: password ? 'default' : undefined,
            password: password || undefined,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
            retryStrategy: (times) => Math.min(1000 * times, 15000),
          },
        };
      },
    }),
    RedisModule,
    NotificationsModule,
    AuthModule,
    TenantModule,
    EventModule,
    CloudinaryModule,
    PaystackModule,
    ResendModule,
    OrderModule,
    TicketModule,
    AnalyticsModule,
    AuditModule,
    CommunicationsModule,
    EmailLogModule,
    PayoutModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    SeedService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
