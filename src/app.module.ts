import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
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

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        let uri = configService.get<string>('MONGODB_URI');
        if (!uri || uri.includes('localhost:27017')) {
          try {
            const mongod = await MongoMemoryServer.create();
            uri = mongod.getUri();
            console.log(`🍃 Embedded MongoDB Memory Server started at ${uri}`);
          } catch (e) {
            console.warn(`MongoMemoryServer notice: ${e.message}, defaulting to Mongo URI.`);
            uri = uri || 'mongodb://localhost:27017/ticketr_db';
          }
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
            retryStrategy: (times) => {
              if (times > 2) return null;
              return 1000;
            },
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
  ],
  controllers: [AppController],
  providers: [
    AppService,
    SeedService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
